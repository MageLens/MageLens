#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
source "$(dirname "$0")/../bin/common"
preflight
[[ $# == 0 ]] || fail 'Usage: bash tests/e2e-isolated.sh (see tests/README.md for configuration)'
theme=${MAGELENS_E2E_THEME:-luma}
runner=${MAGELENS_E2E_RUNNER:-cypress}
platform=${MAGELENS_E2E_PLATFORM:-magento}
[[ "$theme" == luma || "$theme" == hyva ]] || fail 'MAGELENS_E2E_THEME must be luma or hyva (Hyva CSP).'
[[ "$runner" == cypress || "$runner" == playwright ]] || fail 'MAGELENS_E2E_RUNNER must be cypress or playwright.'
[[ "$platform" == magento || "$platform" == mageos ]] || fail 'MAGELENS_E2E_PLATFORM must be magento or mageos.'
install_options=()
[[ "$platform" != mageos ]] || install_options+=(--mageos)
[[ "$theme" != hyva ]] || install_options+=(--hyva)
[[ "$runner" != playwright ]] || install_options+=(--playwright)

if [[ "$platform" == mageos ]]; then
    # Exercise the public distribution without inheriting Marketplace credentials.
    auth_mount=''
elif [[ -n "${MAGELENS_COMPOSER_AUTH_VOLUME:-}" ]]; then
    docker volume inspect "$MAGELENS_COMPOSER_AUTH_VOLUME" >/dev/null
    auth_mount="type=volume,source=$MAGELENS_COMPOSER_AUTH_VOLUME,target=/auth-source,readonly"
    auth_path=/auth-source/auth.json
else
    auth=${MAGELENS_COMPOSER_AUTH_FILE:-${COMPOSER_HOME:-$HOME/.composer}/auth.json}
    [[ -r "$auth" ]] || fail 'Set MAGELENS_COMPOSER_AUTH_FILE to a readable auth.json, or MAGELENS_COMPOSER_AUTH_VOLUME to an existing Composer credentials volume.'
    auth=$(cd "$(dirname "$auth")" && pwd)/$(basename "$auth")
    auth_mount="type=bind,source=$auth,target=/auth.json,readonly"
    auth_path=/auth.json
fi
original_root=$ROOT
scratch=$(mktemp -d /tmp/magelens-e2e.XXXXXX)
project="magelens-e2e-$(basename "$scratch" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
artifacts="$original_root/.runtime/e2e/$project"
mkdir -p "$artifacts"
# Override inherited Compose settings so creation and cleanup target only this run.
export COMPOSE_PROJECT_NAME="$project" APPLICATION_DOMAIN="$project.test"
export APPLICATION_PORT=${MAGELENS_TEST_PORT:-18080}
export APPLICATION_HTTPS_PORT=${MAGELENS_TEST_HTTPS_PORT:-18443}
export RUNNER_VIEW_PORT=${MAGELENS_TEST_VIEW_PORT:-16080}

cleanup() {
    local result=$?
    trap - EXIT
    if [[ -d "$scratch/coverage" ]]; then
        cp -a "$scratch/coverage" "$artifacts/" || result=1
    fi
    if [[ -d "$scratch/cypress/screenshots" ]]; then
        cp -a "$scratch/cypress/screenshots" "$artifacts/" || result=1
    fi
    if (( result != 0 )) && [[ "${MAGELENS_E2E_KEEP_ON_FAILURE:-0}" == 1 ]]; then
        printf 'Failed E2E workspace retained for debugging: %s\n' "$scratch" >&2
        printf 'Clean up with: cd %q && ./bin/application-compose --profile "*" down --volumes --remove-orphans\n' "$scratch" >&2
        exit "$result"
    fi
    if [[ -f "$scratch/.runtime/docker-magento/compose/compose.yaml" ]]; then
        (cd "$scratch" && ./bin/application-compose logs --no-color) > "$artifacts/services.log" 2>&1 || true
        # Include the install-only workspace profile so its legacy appdata volume
        # is removed even though the one-off workspace container has exited.
        if ! (cd "$scratch" && ./bin/application-compose --profile '*' down --volumes --remove-orphans); then
            printf 'Cleanup failed; temporary workspace retained at %s\n' "$scratch" >&2
            exit 1
        fi
    fi
    # The credentials volume can exist even when installation fails before Compose starts.
    if docker volume inspect "${project}_composerdata" >/dev/null 2>&1; then
        docker volume rm "${project}_composerdata" >/dev/null || result=1
    fi
    rm -rf "$scratch"
    printf 'E2E artifacts: %s\n' "$artifacts"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for file in bin docker patches cypress playwright tests assets install.sh .dockerignore compose.yaml dependencies.yaml coverage.config.json package.json package-lock.json cypress.config.cjs playwright.config.cjs README.md; do
    cp -a "$file" "$scratch/"
done
mkdir -p "$scratch/docker/php/e2e"
cp tests/fixtures/compatibility/*.php "$scratch/docker/php/e2e/"
cp tests/php-report.test.php "$scratch/docker/php/e2e/"
# Exercise the bundled demo only; existing Magento data and third-party modules
# are not fixtures. Composer downloads a clean source tree into this workspace.
mkdir -p "$scratch/src/app/code" "$scratch/src/app/design/frontend"
cp -a src/app/code/Application "$scratch/src/app/code/"
cp -a src/app/design/frontend/Application "$scratch/src/app/design/frontend/"
mkdir -p "$scratch/src/app/code/MageLens"
cp -a tests/fixtures/compatibility/module "$scratch/src/app/code/MageLens/Compatibility"
if [[ -n "${MAGELENS_TEMPLATE_COVERAGE_PACKAGE:-}" ]]; then
    mkdir -p "$scratch/.runtime"
    cp "$MAGELENS_TEMPLATE_COVERAGE_PACKAGE" "$scratch/.runtime/template-coverage.tgz"
fi
cd "$scratch"
# Include the original CSP vendor templates that exposed the dynamic-listener
# regression, as well as the exercised compatibility fixture.
if [[ "$theme" == hyva ]]; then
    printf '%s\n' '{"vendorRoots":["vendor/hyva-themes/magento2-default-theme-csp"]}' > coverage.config.json
fi
printf 'APPLICATION_DOMAIN=%s\nAPPLICATION_PORT=%s\nAPPLICATION_HTTPS_PORT=%s\nRUNNER_VIEW_PORT=%s\n' \
    "$APPLICATION_DOMAIN" "$APPLICATION_PORT" "$APPLICATION_HTTPS_PORT" "$RUNNER_VIEW_PORT" > .env
# Isolate the PHP image tag too; the runner already uses the Compose project name.
sed 's|^    image: magelens-php:.*|    image: ${COMPOSE_PROJECT_NAME}-php:e2e|' compose.yaml > compose.yaml.tmp
mv compose.yaml.tmp compose.yaml
grep -qF 'image: ${COMPOSE_PROJECT_NAME}-php:e2e' compose.yaml || fail 'Could not isolate the PHP image tag.'

if [[ -n "$auth_mount" ]]; then
    docker volume create --label "com.docker.compose.project=$project" \
        --label com.docker.compose.volume=composerdata "${project}_composerdata" >/dev/null
    bootstrap_image=$RUNNER_IMAGE
    [[ "$runner" != playwright ]] || bootstrap_image=$PLAYWRIGHT_RUNNER_IMAGE
    docker run --rm --user root --entrypoint sh \
        --mount "$auth_mount" \
        --mount "type=volume,source=${project}_composerdata,target=/composer" \
        "$bootstrap_image" -c 'cp "$3" /composer/auth.json && chmod 600 /composer/auth.json && chown "$1:$2" /composer/auth.json' \
        sh "$LOCAL_UID" "$LOCAL_GID" "$auth_path"
fi

(
    unset COMPOSE_PROJECT_NAME
    ./install.sh --project-name "$project" --container-only "${install_options[@]}" "$APPLICATION_DOMAIN"
    [[ "$(cat .runtime/compose-project-name)" == "$project" ]]
    grep -qxF "COMPOSE_PROJECT_NAME=$project" .env
    database=$(./bin/application-compose ps -q db)
    [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$database")" == "$project" ]]
    ./bin/runner node tests/verify-installation.cjs "$theme" "$runner" "$platform"
    bash tests/runner-container.sh "$(./bin/application-compose images -q runner)"
    # Verify HTTPS routing through nginx, including the read-only viewer redirect.
    ./bin/application-compose exec -T phpfpm bash -c '
        set -euo pipefail
        url=$(bash /application/docker/php/base-url.sh --print-viewer)
        curl --fail --silent --show-error --insecure "$url" --head | grep -F "view_only=1"
        html=$(curl --fail --silent --show-error --insecure "${url}vnc.html")
        [[ "$html" == *noVNC* ]]
    '
    ./bin/application-compose exec -T phpfpm php /application/docker/php/e2e/verify-installation.php "$theme" "$platform" "$PHP_VERSION"
    if [[ "$platform" == mageos ]]; then
        ./bin/application-compose exec -T phpfpm test ! -f /var/www/.composer/auth.json
    fi
    ./bin/runner node tests/dependencies.test.cjs
    ./bin/application-compose exec -T -e MAGELENS_REPORT_DATA=/application/docker/php/report-data.php phpfpm \
        php -d pcov.directory=/tmp -d pcov.exclude= /application/docker/php/e2e/php-report.test.php
    if [[ "$runner" == playwright ]]; then
        ./bin/runner npm install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund @elgentos/magento2-playwright@7.1.0
        ./bin/runner node tests/setup-compatibility.cjs
    fi
    ./bin/application-compose exec -T phpfpm bash /application/docker/php/refresh-assets.sh
    # The installer selection must drive coverage without an extra runner flag.
    ./bin/run-coverage
    ./bin/application-compose exec -T phpfpm php /application/docker/php/e2e/verify-php-report.php
    ./bin/runner node tests/verify-demo.cjs
    ./bin/runner node tests/verify-scenarios.cjs
    ./bin/runner node tests/verify-e2e.cjs
    ./bin/runner node tests/verify-compatibility.cjs "$theme"
    if [[ "$runner" == cypress ]]; then ./bin/runner node tests/cypress-runtime.cjs; fi
    cp .runtime/e2e-installation.json coverage/installation.json
    mkdir -p "$artifacts/$runner"
    cp -a coverage "$artifacts/$runner/"
    if [[ -n "${MAGELENS_E2E_RESULT_FILE:-}" ]]; then printf '%s\n' "$artifacts/$runner/coverage" > "$MAGELENS_E2E_RESULT_FILE"; fi
) 2>&1 | tee "$artifacts/run.log"
printf 'PASS: isolated %s/%s/%s installation and PHP/JavaScript/template coverage.\n' "$platform" "$theme" "$runner"
