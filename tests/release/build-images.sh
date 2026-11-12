#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

# Shared native image build and regression checks for PR CI and the qualified publisher.
source "$(dirname "$0")/../../bin/common"
mode=${1:-publish}
release_repository=$(node -p 'require("./bin/image-inputs.cjs").repository')
release_source=$(node -p 'require("./bin/image-inputs.cjs").repositoryUrl')
release_registry=$(node -p 'require("./bin/image-inputs.cjs").imageRegistry')
[[ "$mode" == test || "$mode" == publish ]] || fail 'Unknown image build mode.'
[[ "$mode" == test ]] || [[ "${GITHUB_REPOSITORY:-}" == "$release_repository" && "${GITHUB_EVENT_NAME:-}" == workflow_dispatch ]] || fail 'Images are published only by the MageLens release workflow.'
architecture=$(docker info --format '{{.Architecture}}')
case "$architecture" in
    x86_64|amd64) architecture=amd64 ;;
    aarch64|arm64) architecture=arm64 ;;
    *) fail "Unsupported image architecture: $architecture" ;;
esac
export MAGELENS_IMAGE_PLATFORM="linux/$architecture"
output="$ROOT/.runtime/release-images/$architecture"
mkdir -p "$output" .runtime/template-package coverage
touch .runtime/template-package/.keep
version=$(node -p 'require("./package.json").version')
for kind in php runner-cypress runner-playwright; do
    fingerprint=$(node bin/image-inputs.cjs inputs "$kind")
    image="magelens-release-$kind:build"
    if [[ "$kind" == php ]]; then
        git clone --depth 1 --branch "$MARKSHUST_DOCKER_MAGENTO_VERSION" https://github.com/markshust/docker-magento.git .runtime/docker-magento
        "$ROOT/bin/build-php-image"
        docker build --target portable --file docker/php/Dockerfile --tag "$image" \
            --label "org.magelens.inputs=$fingerprint" --label "org.opencontainers.image.source=$release_source" \
            --build-arg "PHP_IMAGE=$APPLICATION_PHP_IMAGE" --build-arg "EXPECTED_PHP_VERSION=$PHP_VERSION" \
            --build-arg "PIE_VERSION=$PIE_VERSION" --build-arg "PCOV_VERSION=$PCOV_VERSION" .
        docker run --rm --entrypoint php \
            --mount "type=bind,source=$ROOT/tests,target=/tests,readonly" \
            --mount "type=bind,source=$ROOT/docker/php,target=/application/docker/php,readonly" \
            --env MAGELENS_REPORT_DATA=/application/docker/php/report-data.php \
            "$image" -d pcov.directory=/tmp -d pcov.exclude= /tests/php-report.test.php
    else
        export MAGELENS_RUNNER=${kind#runner-} TEMPLATE_COVERAGE_PACKAGE=''
        source "$ROOT/bin/sync-runner-dependencies"
        docker build --pull --target "$MAGELENS_RUNNER" --file docker/runner/Dockerfile --tag "$image" \
            --label "org.magelens.inputs=$fingerprint" --label "org.opencontainers.image.source=$release_source" \
            --build-arg "RUNNER_IMAGE=$RUNNER_IMAGE" --build-arg "PLAYWRIGHT_RUNNER_IMAGE=$PLAYWRIGHT_RUNNER_IMAGE" \
            --build-arg "CHROME_VERSION=$CHROME_VERSION" --build-arg "CHROME_LINUX_X64_SHA256=$CHROME_LINUX_X64_SHA256" \
            --build-arg "CHROME_LINUX_ARM64_SHA256=$CHROME_LINUX_ARM64_SHA256" .
        checks=()
        [[ "$MAGELENS_RUNNER" != cypress ]] || checks=(--cypress-regressions)
        bash tests/runner-container.sh "$image" ${checks[@]+"${checks[@]}"}
        if [[ "$MAGELENS_RUNNER" == cypress ]]; then
            node -e 'const a=require("node:assert/strict");const r=require("./coverage/cypress-runner-results.json");a.equal(r.browserVersion,process.env.CHROME_VERSION);a.equal(r.browserName,"chrome-for-testing");'
        fi
    fi
    [[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" == "$MAGELENS_IMAGE_PLATFORM" ]] || fail 'Image architecture does not match the builder.'
    [[ "$mode" == publish ]] || continue
    # Push directly: Docker/OCI archives never enter Actions artifact storage.
    # A retry must not move the tag off the currently published digest. GHCR
    # requires a tagged version to remain when deleting a failed candidate.
    reference="$release_registry/$kind:$version-linux-$architecture-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
    skopeo copy --format oci --digestfile "$output/$kind.digest" "docker-daemon:$image" "docker://$reference"
    digest=$(cat "$output/$kind.digest")
    node tests/release/images.cjs record "$kind" "$fingerprint" "$digest" "$output/$kind.json"
done
[[ "$mode" == publish ]] || exit 0
for kind in php runner-cypress runner-playwright; do
    digest=$(cat "$output/$kind.digest")
    skopeo inspect --no-creds "docker://$release_registry/$kind@$digest" >/dev/null || \
        fail 'Anonymous image pull failed. For the first image release, set all three MageLens GHCR packages to Public in package settings, then rerun the publisher.'
done
