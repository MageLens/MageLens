#!/usr/bin/env bash
# Copyright (c)  MageLens
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true
source "$(dirname "$0")/../bin/common"
preflight
[[ $# == 0 ]] || fail 'Usage: bash tests/e2e-isolated.sh (see tests/README.md for configuration)'
theme=${MAGELENS_E2E_THEME:-luma}
runner=${MAGELENS_E2E_RUNNER:-cypress}
platform=${MAGELENS_E2E_PLATFORM:-magento}
mode=${MAGELENS_E2E_MODE:-developer}
[[ "$theme" == luma || "$theme" == hyva ]] || fail 'MAGELENS_E2E_THEME must be luma or hyva (Hyva CSP).'
[[ "$runner" == cypress || "$runner" == playwright ]] || fail 'MAGELENS_E2E_RUNNER must be cypress or playwright.'
[[ "$platform" == magento || "$platform" == mageos ]] || fail 'MAGELENS_E2E_PLATFORM must be magento or mageos.'
[[ "$mode" == developer || "$mode" == production ]] || fail 'MAGELENS_E2E_MODE must be developer or production.'
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
if [[ -d "$original_root/.runtime/docker-magento/.git" ]]; then
    mkdir -p "$scratch/.runtime"
    cp -a "$original_root/.runtime/docker-magento" "$scratch/.runtime/"
    git -C "$scratch/.runtime/docker-magento" remote set-url origin "$original_root/.runtime/docker-magento"
fi
mkdir -p "$scratch/docker/php/e2e"
cp tests/fixtures/compatibility/*.php "$scratch/docker/php/e2e/"
cp -a tests/fixtures/compatibility/invalid-layout "$scratch/docker/php/e2e/"
cp tests/php-report.test.php tests/xml-observers.test.php tests/xml-observer-interceptor.php tests/xml-plugins.test.php tests/xml-preference-hook-proof.php tests/xml-preferences.test.php tests/xml-di-usage-hook-proof.php "$scratch/docker/php/e2e/"
cp tests/xml-layout-nested-modifiers-proof.php tests/xml-compiled-di-hook-proof.php tests/xml-layout-template-field-proof.php tests/xml-layout-direct-template-proof.php tests/xml-layout-factory-lazy-proof.php tests/xml-layout-argument-groups-proof.php tests/xml-layout-argument-fields-proof.php tests/xml-layout-template-value-proof.php tests/xml-layout-failed-action-proof.php tests/xml-layout-shared-action-proof.php tests/xml-layout-magic-action-proof.php tests/xml-layout-callback-health-proof.php tests/xml-layout-argument-storage-proof.php tests/xml-layout-runtime-hooks.test.php tests/xml-layout-names-hook-proof.php tests/xml-layout-action-guard-proof.php tests/xml-layout-file-descriptor-hook-proof.php tests/xml-layout-registry-hook-proof.php tests/xml-layout-ui-hook-proof.php tests/xml-layout-reader-hook-proof.php tests/xml-layout-merge-hook-proof.php tests/xml-layout-argument-hook-proof.php tests/xml-layout-class-hook-proof.php tests/xml-layout-template-hook-proof.php tests/xml-layout-template-validation-hook-proof.php tests/xml-layout-cache-hook-proof.php tests/xml-layout-page-cache-hook-proof.php tests/xml-layout-shared-hook-proof.php tests/xml-layout-move-hook-proof.php tests/xml-layout-move-lazy-proof.php tests/xml-layout-file-list-hook-proof.php tests/xml-layout-render-hook-proof.php tests/xml-layout-falsy-hook-proof.php tests/xml-layout-property-hook-proof.php tests/xml-layout-dependency-hook-proof.php tests/xml-layout-reference-hook-proof.php tests/xml-layout-metadata-hook-proof.php tests/xml-layout-selection-hook-proof.php tests/xml-config-theme-proof.php tests/xml-layout-native-interceptor.php tests/xml-layout-bounds.test.php "$scratch/docker/php/e2e/"
# Exercise the bundled demo only; existing Magento data and third-party modules
# are not fixtures. Composer downloads a clean source tree into this workspace.
mkdir -p "$scratch/src/app/code" "$scratch/src/app/design/frontend"
cp -a src/app/code/Application "$scratch/src/app/code/"
# XML acceptance declarations/routes exist only in this disposable demo checkout.
cp -a src/app/code/Application/Blog/Test/Configuration/fixtures/. "$scratch/src/app/code/Application/Blog/"
touch "$scratch/src/app/code/Application/Blog/Test/Configuration/.enabled"
cp src/app/code/Application/Blog/Test/Configuration/Cypress/settings.cy.js "$scratch/src/app/code/Application/Blog/Test/Cypress/"
cp src/app/code/Application/Blog/Test/Configuration/Playwright/settings.spec.js "$scratch/src/app/code/Application/Blog/Test/Playwright/"

cp -a src/app/design/frontend/Application "$scratch/src/app/design/frontend/"
mkdir -p "$scratch/src/app/code/MageLens"
cp -a tests/fixtures/compatibility/module "$scratch/src/app/code/MageLens/Compatibility"
cp -a tests/fixtures/compatibility/overlay "$scratch/src/app/code/MageLens/LayoutOverlay"
mkdir -p "$scratch/src/app/design/frontend/MageLens"
cp -a tests/fixtures/compatibility/themes/. "$scratch/src/app/design/frontend/MageLens/"
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
    ./bin/application-compose exec -T phpfpm php /application/docker/php/e2e/prepare-layout-providers.php
    ./bin/application-compose exec -T phpfpm php /application/docker/php/e2e/verify-layout-schema.php
    if [[ "$platform" == mageos ]]; then
        ./bin/application-compose exec -T phpfpm test ! -f /var/www/.composer/auth.json
    fi
    ./bin/runner node tests/dependencies.test.cjs
    ./bin/application-compose exec -T -e MAGELENS_REPORT_DATA=/application/docker/php/report-data.php phpfpm \
        php -d pcov.directory=/tmp -d pcov.exclude= /application/docker/php/e2e/php-report.test.php
    ./bin/application-compose exec -T phpfpm php /var/www/html/app/code/Application/Blog/Test/Configuration/merge.test.php
    mkdir -p coverage
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-observers.test.php
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-plugins.test.php
    for di_usage_case in proof collector collector-stale collector-gaps; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-di-usage-hook-proof.php /var/www/html/vendor "$di_usage_case"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-compiled-di-hook-proof.php
    for preference_case in cold warm stale-removed stale-retained stale-mutation broken-hook; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-preferences.test.php /var/www/html/vendor "$preference_case"
    done
    if [[ "$platform" == mageos ]]; then
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-plugins.test.php inline
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-plugins.test.php inline stale-inline
    fi
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-bounds.test.php
    for registry_case in native missing-import missing-attribute missing-cdata stale limit; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-registry-hook-proof.php "$registry_case"
    done
    for ui_case in native missing-factory missing-key missing-decision missing-dynamic-key missing-dynamic-decision missing-magic dynamic-limit; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-ui-hook-proof.php "$ui_case"
    done
    reader_cases=(native fallback plugin parser reader missing-reader)
    if [[ "$platform" == mageos ]]; then reader_cases+=(compiled-fallback compiled-plugin); fi
    for reader_case in "${reader_cases[@]}"; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-reader-hook-proof.php "$reader_case"
    done
    merge_cases=(native theme-getter theme-context theme-context-limit missing-theme-area missing-theme-path unused-parser exposed reset document-limit string-plugin xml-plugin parser-plugin late-parser-plugin string-no-parent xml-no-parent package-no-parent opaque-update native-selection standard-selection-plugin selection-no-parent missing-string missing-document missing-package)
    if [[ "$platform" == mageos ]]; then merge_cases+=(compiled-selection); fi
    if [[ "$theme" == hyva ]]; then
        merge_cases+=(package-event package-event-disabled missing-event-manager missing-event-config missing-event-invoker missing-event-observer event-depth observer-depth)
    fi
    for merge_case in "${merge_cases[@]}"; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-merge-hook-proof.php "$merge_case"
    done
    class_cases=(native native-production fallback factory object-manager manager-restore factory-fallback factory-plugin generator-plugin around no-parent missing-factory missing-creation missing-wrapper missing-creation-pre missing-creation-post missing-manager missing-manager-pre missing-manager-post manager-depth registration-limit missing-registration missing-block-process missing-render-path)
    if [[ "$platform" == mageos ]]; then class_cases+=(compiled-fallback compiled-generator-plugin compiled-factory-plugin compiled-around); fi
    for class_case in "${class_cases[@]}"; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-class-hook-proof.php "$class_case"
    done
    for lazy_factory_mode in '' --lazy-manager --lazy-generator; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-factory-lazy-proof.php "$lazy_factory_mode" --without-collector
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-factory-lazy-proof.php "$lazy_factory_mode"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-factory-lazy-proof.php --receiver-limit
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-shared-hook-proof.php
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-render-hook-proof.php --without-collector
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-render-hook-proof.php
    for reference_case in native equal-schedule custom-block-reader custom-container-reader; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-reference-hook-proof.php "$reference_case" --without-collector
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-reference-hook-proof.php "$reference_case"
    done
    for reference_case in missing-block-reader missing-container-reader missing-child-writer missing-child-parent missing-child-lookup; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-reference-hook-proof.php "$reference_case"
    done
    for reference_case in missing-structure missing-generator missing-removal missing-child-schedule missing-child-helper; do
        for reference_half in "" -pre -post; do
            ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
                php /application/docker/php/e2e/xml-layout-reference-hook-proof.php "$reference_case$reference_half"
        done
    done
    for reference_case in structure-depth removal-depth generator-depth schedule-depth placement-depth; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-reference-hook-proof.php "$reference_case"
    done
    property_baseline="$(./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-property-hook-proof.php --without-collector)"
    printf '%s\n' "$property_baseline"
    property_reads="$(printf '%s\n' "$property_baseline" | sed -n 's/^Native property reads: //p')"
    if [[ -z "$property_reads" ]]; then
        echo "Missing native property read baseline" >&2
        exit 1
    fi
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-property-hook-proof.php --expected-reads "$property_reads"
    dependency_baseline="$(./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-dependency-hook-proof.php --without-collector)"
    printf '%s\n' "$dependency_baseline"
    dependency_reads="$(printf '%s\n' "$dependency_baseline" | sed -n 's/^Native dependency reads: //p')"
    if [[ -z "$dependency_reads" ]]; then
        echo "Missing native dependency read baseline" >&2
        exit 1
    fi
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-dependency-hook-proof.php --expected-reads "$dependency_reads"
    for move_storage in hooked-storage custom-getter; do
        move_baseline="$(./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-move-hook-proof.php "$move_storage" --without-collector)"
        printf '%s\n' "$move_baseline"
        if [[ ! "$move_baseline" =~ Native\ move\ storage/getter\ reads:\ ([0-9]+) ]]; then
            echo "Missing native move storage baseline" >&2
            exit 1
        fi
        move_reads="${BASH_REMATCH[1]}"
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-move-hook-proof.php "$move_storage" --expected-reads "$move_reads"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-move-lazy-proof.php --without-collector
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-move-lazy-proof.php
    for move_case in native programmatic same unchanged sibling-missing alias-fallback overridden missing-writer missing-order missing-execution missing-list missing-reader missing-reader-entry missing-reader-end missing-order-pre missing-order-post missing-execution-pre missing-execution-post missing-schedule-pre missing-schedule-post reader-depth execution-depth interpret-depth custom-structure; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-move-hook-proof.php "$move_case"
    done
    if [[ "$platform" == mageos ]]; then
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-shared-hook-proof.php unverified-scope
    fi
    for metadata_case in native missing-api missing-attribute missing-label missing-type depth; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-metadata-hook-proof.php "$metadata_case"
    done
    for selection_area in frontend adminhtml; do
        for selection_case in native missing-getter; do
            ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
                php /application/docker/php/e2e/xml-layout-selection-hook-proof.php "$selection_area" "$selection_case"
        done
    done
    if [[ "$platform" == mageos ]]; then
        for selection_case in standard missing-plugin missing-condition missing-lookup; do
            ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
                php /application/docker/php/e2e/xml-layout-selection-hook-proof.php adminhtml "$selection_case"
        done
    fi
    template_cases=(native unmapped unmapped-first getter file resolver engine engine-inherited engine-inherited-fallback fallback resolver-fallback engine-fallback getter-plugin file-plugin resolver-plugin engine-plugin around engine-around custom-theme-plugin missing-getter missing-file missing-resolver missing-getter-pre missing-getter-post missing-theme-plugin missing-plugin-lookup missing-engine missing-engine-pre missing-engine-post missing-engine-wrapper missing-engine-pool resolution-depth rendering-depth before-plugin-depth)
    if [[ "$theme" == hyva ]]; then template_cases+=(missing-engine-plugin missing-engine-lookup); fi
    if [[ "$platform" == mageos ]]; then template_cases+=(compiled-fallback compiled-resolver-fallback compiled-engine-fallback compiled-getter-plugin compiled-file-plugin compiled-resolver-plugin compiled-engine-plugin compiled-around compiled-engine-around); fi
    for template_case in "${template_cases[@]}"; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-template-hook-proof.php "$template_case"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-falsy-hook-proof.php --without-collector
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-falsy-hook-proof.php
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-falsy-hook-proof.php --zero-class-only
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-magic-action-proof.php --without-collector
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-magic-action-proof.php
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-argument-groups-proof.php --without-collector
    argument_group_selector_calls=6
    [[ "$platform" != mageos ]] || argument_group_selector_calls=12
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-argument-groups-proof.php --custom-selector --without-collector --selector-calls "$argument_group_selector_calls"
    for argument_group_mode in '' --custom-selector --missing-group-pre --missing-group-post --missing-parser --group-depth --group-node-limit; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-argument-groups-proof.php "$argument_group_mode" --selector-calls "$argument_group_selector_calls"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-argument-fields-proof.php --first-layout --without-collector
    for first_layout_mode in '' --missing-dispatch-pre --missing-dispatch-post --missing-first-dispatch-pre --missing-first-dispatch-post; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-argument-fields-proof.php --first-layout "$first_layout_mode"
    done
    for first_foreign_mode in --without-collector '' --missing-native-first-pre --missing-native-first-post; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-argument-fields-proof.php --first-layout --foreign-lookup "$first_foreign_mode"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-argument-fields-proof.php --without-collector
    for argument_field_mode in '' --missing-dispatch-pre --missing-dispatch-post --custom-dispatch --alternate-discriminator --custom-forwarder; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-argument-fields-proof.php "$argument_field_mode"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-argument-fields-proof.php --service-url --without-collector
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-argument-fields-proof.php --service-url
    for modifier_mode in '' --custom-dispatch --alternate-discriminator --custom-forwarder --missing-modifier-pre --missing-modifier-post --missing-modifier-both; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-argument-fields-proof.php --modifier-fields "$modifier_mode"
    done
    for nested_type_native in '' --custom-items; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-argument-fields-proof.php --nested-types "$nested_type_native" --without-collector
    done
    for nested_type_mode in '' --custom-items --missing-items-pre --missing-items-post; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-argument-fields-proof.php --nested-types "$nested_type_mode"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-template-value-proof.php --without-collector
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-template-value-proof.php
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-direct-template-proof.php --without-collector
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-direct-template-proof.php
    for direct_template in --reflection --closure; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-direct-template-proof.php --without-collector "$direct_template"
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-direct-template-proof.php "$direct_template"
    done
    for nested_modifier_option in --without-collector ''; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-nested-modifiers-proof.php "$nested_modifier_option"
    done
    for template_field in clean literal variable braced foreign public hook reflection opaque edit symlink missing class-limit file-limit access-limit; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-template-field-proof.php "$template_field"
    done
    for template_value_missing in --missing-constructor-pre --missing-constructor-post --missing-getter --missing-setter --missing-query --method-limit --method-name-limit; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-template-value-proof.php "$template_value_missing"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-failed-action-proof.php --without-collector
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-failed-action-proof.php
    for action_failure in --missing-action-pre --missing-action-post --missing-evaluation-pre --missing-evaluation-post --action-depth; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-failed-action-proof.php "$action_failure"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-layout-failed-action-proof.php --partial-only
    for action_interpreter in --missing-interpreter-pre --missing-interpreter-post; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-failed-action-proof.php "$action_interpreter" --partial-only
    done
    for shared_case in guarded unguarded distinct; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-shared-action-proof.php "$shared_case" --without-collector
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-shared-action-proof.php "$shared_case"
    done
    for shared_bound in --alias-limit --binding-limit; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-shared-action-proof.php "$shared_bound"
    done
    for shared_missing in --missing-process --missing-snapshot; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-shared-action-proof.php unguarded "$shared_missing"
    done
    for storage_case in array-access object-error; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-argument-storage-proof.php "$storage_case" --without-collector
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-argument-storage-proof.php "$storage_case"
    done
    for callback_case in healthy pre post; do
        callback_result=$(./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-callback-health-proof.php "$callback_case" 2>&1)
        printf '%s\n' "$callback_result"
        if [[ "$callback_result" == *'OpenTelemetry:'* || "$callback_result" == *'private-callback-payload'* ]]; then
            fail 'Layout callback failure escaped into native output.'
        fi
    done
    for callback_case in healthy throw depth trace-limit location; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-runtime-hooks.test.php "$callback_case"
    done
    for names_case in blocks move containers; do
        for names_collection in --without-collector ''; do
            names_options=()
            if [[ -n "$names_collection" ]]; then names_options+=("$names_collection"); fi
            names_result=$(./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
                php /application/docker/php/e2e/xml-layout-names-hook-proof.php "$names_case" "${names_options[@]}" 2>&1)
            printf '%s\n' "$names_result"
            if [[ "$names_result" == *'OpenTelemetry:'* ]]; then fail 'Numeric layout names caused an instrumentation warning.'; fi
        done
    done
    for guard_case in native guard-only zero-hit unvisited-scope unguarded dynamic equal-write custom-snapshot snapshot-limit delegated-flag delegated-scope failed-flag; do
        guard_native=$(./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-action-guard-proof.php "$guard_case" --without-collector)
        printf '%s\n' "$guard_native"
        guard_options=()
        if [[ "$guard_case" == custom-snapshot ]]; then
            guard_reads=$(printf '%s\n' "$guard_native" | sed -n 's/^Native action schedule reads: //p')
            [[ -n "$guard_reads" ]] || fail 'Missing native action schedule getter baseline.'
            guard_options=(--expected-reads "$guard_reads")
        fi
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-action-guard-proof.php "$guard_case" "${guard_options[@]}"
    done
    for guard_observation in process snapshot scope flag; do
        for guard_side in '' -pre -post; do
            ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
                php /application/docker/php/e2e/xml-layout-action-guard-proof.php "missing-$guard_observation$guard_side"
        done
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-action-guard-proof.php "$guard_observation-depth"
    done
    for descriptor_case in native redeclared accessor hook magic; do
        descriptor_native=$(./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-file-descriptor-hook-proof.php "$descriptor_case" --without-collector)
        printf '%s\n' "$descriptor_native"
        descriptor_reads=$(printf '%s\n' "$descriptor_native" | sed -n 's/^Native file-descriptor reads: //p')
        [[ -n "$descriptor_reads" ]]
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-file-descriptor-hook-proof.php "$descriptor_case" --expected-reads "$descriptor_reads"
    done
    for file_list_case in native hook magic; do
        file_list_baseline=$(./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-file-list-hook-proof.php "$file_list_case" --without-collector)
        printf '%s\n' "$file_list_baseline"
        file_list_reads=$(printf '%s\n' "$file_list_baseline" | sed -n 's/^Native file-list reads: //p')
        [[ -n "$file_list_reads" ]] || fail 'Missing native file-list getter baseline.'
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-file-list-hook-proof.php "$file_list_case" --expected-reads "$file_list_reads"
    done
    for validation_case in native missing unset-dependencies override parent-override; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-template-validation-hook-proof.php "$validation_case" --without-collector
    done
    for validation_case in native missing unset-dependencies override parent-override missing-pre missing-post missing-both; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-template-validation-hook-proof.php "$validation_case"
    done
    for cache_case in native equal ui missing-read missing-loader missing-pre missing-post depth; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-cache-hook-proof.php "$cache_case"
    done
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php /application/docker/php/e2e/xml-config-theme-proof.php
    for page_cache_case in native warm equal missing-pre missing-post depth; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-page-cache-hook-proof.php "$page_cache_case"
    done
    (
        invalid_class=src/app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_classdefault_index.xml
        [[ ! -e "$invalid_class" ]] || fail 'Disposable invalid class fixture path already exists.'
        cleanup_invalid_class() {
            local result=$?
            trap - EXIT
            if [[ -e "$invalid_class" ]]; then rm -- "$invalid_class"; fi
            ./bin/runner node bin/prepare.cjs --runtime-only --theme-roots .runtime/active-themes.json || result=1
            exit "$result"
        }
        trap cleanup_invalid_class EXIT
        trap 'exit 130' INT
        trap 'exit 143' TERM
        cp tests/fixtures/compatibility/invalid-layout/class-empty.xml "$invalid_class"
        ./bin/runner node bin/prepare.cjs --runtime-only --theme-roots .runtime/active-themes.json
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-class-hook-proof.php empty-class
    )
    for argument_case in native reader generator missing-interpreter missing-reader missing-generator missing-action batch-depth interpreter-depth action-depth argument-limit; do
        ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
            php /application/docker/php/e2e/xml-layout-argument-hook-proof.php "$argument_case"
    done
    # Original-source fixture assertions need fresh native layout interpretation.
    # Registry proofs separately verify warm cache zero-hit provenance boundaries.
    ./bin/application-compose exec -T phpfpm php bin/magento cache:disable layout block_html full_page
    coverage_options=()
    if [[ "$mode" == production ]]; then
        ./bin/deploy-production
        ./bin/application-compose exec -T phpfpm php bin/magento deploy:mode:show | grep -F 'Current application mode: production'
        coverage_options+=(--refresh-assets)
    else
        ./bin/application-compose exec -T phpfpm bash /application/docker/php/refresh-assets.sh
    fi
    # The installer selection must drive coverage without an extra runner flag.
    mkdir -p coverage
    printf 'obsolete report content\n' > coverage/obsolete-publication.txt
    ./bin/run-coverage "${coverage_options[@]}" | tee .runtime/coverage-run.log
    ./bin/runner node tests/verify-report-publication.cjs
    ./bin/application-compose exec -T phpfpm php /application/docker/php/e2e/verify-php-report.php
    ./bin/runner node --test src/app/code/Application/Blog/Test/Configuration/coverage.test.cjs
    ./bin/runner node tests/verify-demo.cjs
    ./bin/runner node tests/verify-scenarios.cjs
    ./bin/runner node tests/verify-e2e.cjs
    ./bin/runner node tests/verify-compatibility.cjs "$theme"
    for layout_check in tests/verify-layout-*.cjs; do
        case "$layout_check" in
            tests/verify-layout-admin.cjs) ./bin/runner node "$layout_check" "$platform" ;;
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
    if [[ -n "${MAGELENS_E2E_RESULT_FILE:-}" ]]; then printf '%s\n' "$artifacts/$runner/coverage" > "$MAGELENS_E2E_RESULT_FILE"; fi
) 2>&1 | tee "$artifacts/run.log"
printf 'PASS: isolated %s/%s/%s installation and PHP/JavaScript/template coverage.\n' "$platform" "$theme" "$runner"
