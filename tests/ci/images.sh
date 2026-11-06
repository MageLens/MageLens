#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

# Build public tooling only, before any application credentials or fixtures exist.
source "$(dirname "$0")/../../bin/common"
action=$1
case "$action" in
    build)
        kind=$2
        output=$3
        [[ "$kind" == php || "$kind" == runner-cypress || "$kind" == runner-playwright ]] || fail 'Unknown image kind.'
        mkdir -p "$output" .runtime/template-package
        touch .runtime/template-package/.keep
        fingerprint=$(node bin/image-inputs.cjs inputs "$kind")
        image="magelens-candidate-$kind:build"
        if [[ "$kind" == php ]]; then
            git clone --depth 1 --branch "$MARKSHUST_DOCKER_MAGENTO_VERSION" https://github.com/markshust/docker-magento.git .runtime/docker-magento
            "$ROOT/bin/build-php-image"
            docker build --target portable --file docker/php/Dockerfile --tag "$image" \
                --label "org.magelens.inputs=$fingerprint" --label "org.opencontainers.image.source=https://github.com/MageLens/MageLens" \
                --build-arg "PHP_IMAGE=$APPLICATION_PHP_IMAGE" --build-arg "EXPECTED_PHP_VERSION=$PHP_VERSION" \
                --build-arg "PIE_VERSION=$PIE_VERSION" --build-arg "PCOV_VERSION=$PCOV_VERSION" .
        else
            export MAGELENS_RUNNER=${kind#runner-} TEMPLATE_COVERAGE_PACKAGE=''
            source "$ROOT/bin/sync-runner-dependencies"
            docker build --pull --target "$MAGELENS_RUNNER" --file docker/runner/Dockerfile --tag "$image" \
                --label "org.magelens.inputs=$fingerprint" --label "org.opencontainers.image.source=https://github.com/MageLens/MageLens" \
                --build-arg "RUNNER_IMAGE=$RUNNER_IMAGE" --build-arg "PLAYWRIGHT_RUNNER_IMAGE=$PLAYWRIGHT_RUNNER_IMAGE" \
                --build-arg "CHROME_VERSION=$CHROME_VERSION" --build-arg "CHROME_LINUX_X64_SHA256=$CHROME_LINUX_X64_SHA256" \
                --build-arg "CHROME_LINUX_ARM64_SHA256=$CHROME_LINUX_ARM64_SHA256" .
        fi
        skopeo copy --format oci "docker-daemon:$image" "oci-archive:$output/image.tar"
        digest="sha256:$(skopeo inspect --raw "oci-archive:$output/image.tar" | sha256sum | cut -d' ' -f1)"
        node tests/ci/images.cjs entry "$kind" "$fingerprint" "$digest" "$output/entry.json"
        ;;
    load)
        directory=$2
        runner=$3
        docker run -d --name magelens-image-registry -p 127.0.0.1:5000:5000 registry:2.8.3
        for attempt in {1..30}; do
            if curl -fsS http://localhost:5000/v2/ >/dev/null; then break; fi
            sleep 1
        done
        for kind in php "runner-$runner"; do
            skopeo copy --preserve-digests --dest-tls-verify=false \
                "oci-archive:$directory/$kind/image.tar" "docker://localhost:5000/magelens/$kind:candidate"
        done
        node tests/ci/images.cjs manifest "$directory" "$directory/images.json"
        ;;
    publish)
        directory=$2
        registry=$3
        [[ "$registry" =~ ^ghcr.io/[a-z0-9_-]+$ ]] || fail 'Invalid release registry.'
        node tests/ci/images.cjs verify "$directory" qualification/images.json
        version=$(node -p 'require("./package.json").version')
        for kind in php runner-cypress runner-playwright; do
            skopeo copy --preserve-digests "oci-archive:$directory/$kind/image.tar" "docker://$registry/$kind:$version-linux-amd64"
            # Public anonymous pulls are part of release usability, even on first publication.
            skopeo inspect --no-creds "docker://$registry/$kind:$version-linux-amd64" >/dev/null
        done
        ;;
    *) fail 'Usage: images.sh build KIND OUTPUT | load DIRECTORY RUNNER | publish DIRECTORY REGISTRY' ;;
esac
