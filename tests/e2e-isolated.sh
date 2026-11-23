#!/usr/bin/env bash
# Copyright (c)  MageLens
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true
source "$(dirname "$0")/common.sh"
source "$TESTS_ROOT/e2e-xml-proofs.sh"
preflight
[[ $# == 0 ]] || fail 'Usage: bash tests/e2e-isolated.sh (see tests/README.md for configuration)'
theme=${MAGELENS_E2E_THEME:-luma}
runner=${MAGELENS_E2E_RUNNER:-cypress}
platform=${MAGELENS_E2E_PLATFORM:-magento}
mode=${MAGELENS_E2E_MODE:-developer}
focus=${MAGELENS_E2E_FOCUS:-}
[[ "$theme" == luma || "$theme" == hyva ]] || fail 'MAGELENS_E2E_THEME must be luma or hyva (Hyva CSP).'
[[ "$runner" == cypress || "$runner" == playwright ]] || fail 'MAGELENS_E2E_RUNNER must be cypress or playwright.'
[[ "$platform" == magento || "$platform" == mageos ]] || fail 'MAGELENS_E2E_PLATFORM must be magento or mageos.'
[[ "$mode" == developer || "$mode" == production ]] || fail 'MAGELENS_E2E_MODE must be developer or production.'
if [[ -n "$focus" && ( "$focus" != default-coverage || "$platform/$theme/$runner/$mode" != magento/luma/cypress/developer ) ]]; then
    fail 'The default-coverage focus requires the default Magento Open Source, Luma and Cypress installation.'
fi
install_options=()
[[ "${MAGELENS_BUILD_FROM_SOURCE:-0}" != 1 ]] || install_options+=(--build-from-source)
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
scratch=$(mktemp -d "${MAGELENS_TEST_TMPDIR:-/tmp}/magelens-e2e.XXXXXX")
project="magelens-e2e-$(basename "$scratch" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
artifacts="$original_root/.runtime/e2e/$project"
mkdir -p "$artifacts"
if [[ -n "${MAGELENS_E2E_RESOURCE_FILE:-}" ]]; then
    printf '%s %s\n' "$project" "$scratch" > "$MAGELENS_E2E_RESOURCE_FILE"
fi
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
        printf 'Then remove its images with: docker image ls --filter %q --format "{{.Repository}}:{{.Tag}}" | grep . | xargs docker image rm\n' "reference=$project-*" >&2
        exit "$result"
    fi
    if [[ -f "$scratch/.runtime/docker-magento/compose/compose.yaml" ]]; then
        (cd "$scratch" && ./bin/application-compose logs --no-color) > "$artifacts/services.log" 2>&1 || true
        # Include the install-only workspace profile so its legacy appdata volume
        # is removed even though the one-off workspace container has exited.
        if ! (cd "$scratch" && ./bin/application-compose --profile '*' down --volumes --remove-orphans); then
            printf 'Cleanup failed; temporary workspace retained at %s, together with its images\n' "$scratch" >&2
            exit 1
        fi
    fi
    # The credentials volume can exist even when installation fails before Compose starts.
    if docker volume inspect "${project}_composerdata" >/dev/null 2>&1; then
        docker volume rm "${project}_composerdata" >/dev/null || result=1
    fi
    # Images tagged with this run's project name are never reused once its workspace is gone.
    # Shared base and service images stay, so later runs keep the layer cache.
    local images
    if ! images=$(docker image ls --filter "reference=$project-*" --format '{{.Repository}}:{{.Tag}}'); then
        result=1
    elif [[ -n "$images" ]]; then
        printf '%s\n' "$images" | xargs docker image rm >/dev/null || result=1
    fi
    rm -rf "$scratch"
    printf 'E2E artifacts: %s\n' "$artifacts"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for file in bin docker patches cypress playwright cli assets install.sh .dockerignore compose.yaml dependencies.yaml coverage.config.json package.json package-lock.json cypress.config.cjs playwright.config.cjs README.md; do
    cp -a "$file" "$scratch/"
done
cp -a "$TESTS_ROOT" "$scratch/tests"
if [[ -d "$original_root/.runtime/docker-magento/.git" ]]; then
    mkdir -p "$scratch/.runtime"
    cp -a "$original_root/.runtime/docker-magento" "$scratch/.runtime/"
    git -C "$scratch/.runtime/docker-magento" remote set-url origin "$original_root/.runtime/docker-magento"
fi
mkdir -p "$scratch/docker/php/e2e"
cp "$TESTS_ROOT"/fixtures/compatibility/*.php "$scratch/docker/php/e2e/"
cp -a "$TESTS_ROOT/fixtures/compatibility/invalid-layout" "$scratch/docker/php/e2e/"
cp "$TESTS_ROOT/php-report.test.php" "$scratch/docker/php/e2e/"
stage_xml_proofs "$scratch/docker/php/e2e"
# Exercise the bundled demo only; existing Magento data and third-party modules
# are not fixtures. Composer downloads a clean source tree into this workspace.
mkdir -p "$scratch/src/app/code" "$scratch/src/app/design/frontend"
cp -a src/app/code/Application "$scratch/src/app/code/"
cp -a src/app/design/frontend/Application "$scratch/src/app/design/frontend/"
if [[ -z "$focus" ]]; then
    # XML acceptance declarations/routes exist only in this disposable demo checkout.
    cp -a src/app/code/Application/Blog/Test/Configuration/fixtures/. "$scratch/src/app/code/Application/Blog/"
    touch "$scratch/src/app/code/Application/Blog/Test/Configuration/.enabled"
    cp src/app/code/Application/Blog/Test/Configuration/Cypress/settings.cy.js "$scratch/src/app/code/Application/Blog/Test/Cypress/"
    cp src/app/code/Application/Blog/Test/Configuration/Playwright/settings.spec.js "$scratch/src/app/code/Application/Blog/Test/Playwright/"

    mkdir -p "$scratch/src/app/code/MageLens"
    cp -a "$TESTS_ROOT/fixtures/compatibility/module" "$scratch/src/app/code/MageLens/Compatibility"
    cp -a "$TESTS_ROOT/fixtures/compatibility/overlay" "$scratch/src/app/code/MageLens/LayoutOverlay"
    cp -a "$TESTS_ROOT/fixtures/compatibility/disabled-module" "$scratch/src/app/code/MageLens/LayoutDisabled"
    cp -a "$TESTS_ROOT/fixtures/ui-module/module" "$scratch/src/app/code/MageLens/UiProbe"
    cp -a "$TESTS_ROOT/fixtures/ui-module/overlay" "$scratch/src/app/code/MageLens/UiProbeOverlay"
    mkdir -p "$scratch/src/app/design/frontend/MageLens"
    cp -a "$TESTS_ROOT/fixtures/compatibility/themes/." "$scratch/src/app/design/frontend/MageLens/"
    cp -a "$TESTS_ROOT/fixtures/admin-navigation/module" "$scratch/src/app/code/MageLens/AdminNavigation"
    touch "$scratch/src/app/code/Application/Blog/Test/Navigation/.enabled"
fi
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
    ./install.sh --project-name "$project" --container-only ${install_options[@]+"${install_options[@]}"} "$APPLICATION_DOMAIN"
    [[ "$(cat .runtime/compose-project-name)" == "$project" ]]
    grep -qxF "COMPOSE_PROJECT_NAME=$project" .env
    database=$(./bin/application-compose ps -q db)
    [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$database")" == "$project" ]]
    ./bin/runner node tests/verify-installation.cjs "$theme" "$runner" "$platform"
    ./bin/runner node tests/failure-snapshot-regressions.cjs "$runner"
    if [[ "$focus" == default-coverage ]]; then
        ./bin/n98-magerun2 --skip-core-commands --version | grep -F "$MAGERUN_VERSION"
        mkdir -p coverage
        prove_blog_controllers
        for pass in default warm; do
            if [[ "$pass" == warm ]]; then cp coverage/xml/coverage.json .runtime/default-xml.json; fi
            printf 'obsolete report content\n' > coverage/obsolete-publication.txt
            MAGELENS_MAGERUN_OFFLINE=1 ./bin/run-coverage | tee .runtime/coverage-run.log
            cp .runtime/coverage-run.log "$artifacts/coverage-$pass.log"
            ./bin/runner node tests/verify-report-publication.cjs bundled-blog
            ./bin/runner node tests/verify-scenarios.cjs coverage bundled-blog
        done
        ./bin/runner node tests/verify-layout-warm-repeat.cjs .runtime/default-xml.json
        printf 'PASS: default installation coverage and warm repeat.\n'
        exit
    fi
    bash tests/runner-container.sh "$(./bin/application-compose images -q runner)"
    # Verify HTTPS routing through nginx, including the read-only viewer redirect.
    ./bin/application-compose exec -T phpfpm bash -c '
        set -euo pipefail
        url=$(bash /application/docker/php/base-url.sh --print-viewer)
        curl --fail --silent --show-error --insecure "$url" --head | grep -F "view_only=1"
        html=$(curl --fail --silent --show-error --insecure "${url}vnc.html")
        [[ "$html" == *noVNC* ]]
    '
    # Use the same native Admin theme for layout evidence on both platforms.
    if [[ "$platform" == mageos ]]; then
        prove_stock_admin_layout "$artifacts"
        ./bin/magento config:set admin/system_admin_design/active_theme Magento/backend
    fi
    ./bin/application-compose exec -T phpfpm php /application/docker/php/e2e/verify-installation.php "$theme" "$platform" "$PHP_VERSION"
    if [[ "$theme" == hyva ]]; then prove_blog_controllers --hyva-cold; fi
    ./bin/application-compose exec -T phpfpm php /application/docker/php/e2e/prepare-layout-providers.php
    ./bin/application-compose exec -T phpfpm php /application/docker/php/e2e/verify-layout-schema.php
    if [[ "$platform" == mageos ]]; then
        ./bin/application-compose exec -T phpfpm test ! -f /var/www/.composer/auth.json
    fi
    ./bin/runner node tests/dependencies.test.cjs
    ./bin/application-compose exec -T -e MAGELENS_REPORT_DATA=/application/docker/php/report-data.php phpfpm \
        php -d pcov.directory=/tmp -d pcov.exclude= /application/docker/php/e2e/php-report.test.php
    ./bin/application-compose exec -T phpfpm php /var/www/html/app/code/Application/Blog/Test/Configuration/merge.test.php
    run_xml_proofs "$theme" "$platform" "$mode"
    run_ui_component_proofs
    ./bin/runner node --test tests/verify-routing-native.cjs
    # Rendering fixtures need to execute through both HTML cache boundaries.
    # Collected HTTP requests already isolate the native layout cache.
    ./bin/application-compose exec -T phpfpm php bin/magento cache:disable block_html full_page
    coverage_options=()
    if [[ "$mode" == production ]]; then
        ./bin/deploy-production
        ./bin/application-compose exec -T phpfpm php bin/magento deploy:mode:show | grep -F 'Current application mode: production'
        coverage_options+=(--refresh-assets)
    fi
    # Prepare the pinned cache through the interactive entry point before coverage.
    ./bin/n98-magerun2 --skip-core-commands --version | grep -F "$MAGERUN_VERSION"
    # Run from the same host as Compose (WSL on Windows), before collection starts.
    node tests/verify-cron-native.cjs
    ./bin/application-compose exec -T phpfpm php /var/www/html/app/code/MageLens/UiProbe/Test/MageLens/hooks.php before
    ./bin/runner node tests/verify-ui-browser-native.cjs "$runner"
    if [[ "$mode" == production ]]; then
        ./bin/application-compose exec -T phpfpm php bin/magento cache:clean config
    else
        # The collected run publishes Admin assets from its instrumented source.
        ./bin/application-compose exec -T phpfpm bash /application/docker/php/refresh-assets.sh
    fi
    # The installer selection must drive coverage without an extra runner flag.
    mkdir -p coverage
    printf 'obsolete report content\n' > coverage/obsolete-publication.txt
    MAGELENS_MAGERUN_OFFLINE=1 ./bin/run-coverage --include-machine-report ${coverage_options[@]+"${coverage_options[@]}"} | tee .runtime/coverage-run.log
    if [[ "$theme/$runner" == hyva/playwright ]]; then
        ./bin/runner node --test tests/hyva-csp-no-observer.cjs
    fi
    ./bin/runner node tests/verify-report-publication.cjs
    ./bin/application-compose exec -T phpfpm php /application/docker/php/e2e/verify-php-report.php
    ./bin/runner node --test src/app/code/Application/Blog/Test/Configuration/coverage.test.cjs
    ./bin/runner node --test src/app/code/Application/Blog/Test/Configuration/routing-coverage.test.cjs
    ./bin/runner node tests/verify-demo.cjs
    ./bin/runner node tests/verify-xml-admin-navigation.cjs
    ./bin/runner node tests/verify-scenarios.cjs
    ./bin/runner node tests/verify-cli-coverage.cjs
    ./bin/runner node tests/verify-xml-cron.cjs
    ./bin/runner node tests/verify-ui-browser-coverage.cjs
    ./bin/runner node tests/verify-attempts.cjs
    ./bin/runner node tests/verify-e2e.cjs
    ./bin/runner node tests/verify-compatibility.cjs "$theme"
    for layout_check in tests/verify-layout-*.cjs; do
        case "$layout_check" in
            tests/verify-layout-warm-repeat.cjs) continue ;;
            tests/verify-layout-handles.cjs) ./bin/runner node "$layout_check" coverage/xml/coverage.json "$platform" ;;
            tests/verify-layout-ui-structure.cjs) ./bin/runner node "$layout_check" coverage/xml/coverage.json "$mode" ;;
            tests/verify-layout-render-failures.cjs) ./bin/runner node "$layout_check" coverage/xml/coverage.json "$mode" ;;
            tests/verify-layout-grammar.cjs) ./bin/runner node "$layout_check" coverage/xml/coverage.json "$mode" ;;
            tests/verify-layout-ownership.cjs) ./bin/runner node "$layout_check" coverage/xml/coverage.json "$theme" ;;
            *) ./bin/runner node "$layout_check" ;;
        esac
    done
    if [[ "$runner" == cypress ]]; then
        ./bin/runner node tests/cypress-runtime.cjs
        ./bin/runner node tests/cypress-regressions.cjs
    fi
    cp .runtime/e2e-installation.json coverage/installation.json
    mkdir -p "$artifacts/$runner"
    cp -a coverage "$artifacts/$runner/"
    # A failed test must not prevent coverage publication. This runs after the compared report
    # is saved, with one disposable spec in place of the acceptance specs, which are restored after.
    specs=.runtime/acceptance-specs
    mkdir -p "$specs"
    find src/app/code -type d \( -path '*/Test/Cypress' -o -path '*/Test/Playwright' \) -prune -print > "$specs.list"
    while read -r directory; do mkdir -p "$specs/$(dirname "$directory")"; mv "$directory" "$specs/$directory"; done < "$specs.list"
    failed_spec=cypress/e2e/failed-run.cy.js
    [[ "$runner" != playwright ]] || failed_spec=playwright/e2e/failed-run.spec.js
    mkdir -p "$(dirname "$failed_spec")"
    cp "tests/fixtures/failed-run/$(basename "$failed_spec")" "$failed_spec"
    printf 'obsolete report content\n' > coverage/obsolete-publication.txt
    # The expected non-zero exit must not end this pipefail script.
    if MAGELENS_MAGERUN_OFFLINE=1 ./bin/run-coverage ${coverage_options[@]+"${coverage_options[@]}"} 2>&1 | tee .runtime/coverage-run.log; then
        fail 'A coverage run with a failed test must exit non-zero.'
    fi
    cp .runtime/coverage-run.log "$artifacts/coverage-failed-run.log"
    grep -qxF "Tests failed in the $runner suite. The reports include their results." .runtime/coverage-run.log \
        || fail 'The failed run must name only the failed browser suite.'
    # No acceptance spec audits HTML in this run.
    ./bin/runner node tests/verify-report-publication.cjs bundled-blog
    ./bin/runner node tests/verify-failed-run.cjs
    rm "$failed_spec"
    while read -r directory; do mv "$specs/$directory" "$directory"; done < "$specs.list"
    if [[ -n "${MAGELENS_E2E_RESULT_FILE:-}" ]]; then printf '%s\n' "$artifacts/$runner/coverage" > "$MAGELENS_E2E_RESULT_FILE"; fi
) 2>&1 | tee "$artifacts/run.log"
printf 'PASS: isolated %s/%s/%s installation and PHP/JavaScript/template coverage.\n' "$platform" "$theme" "$runner"
