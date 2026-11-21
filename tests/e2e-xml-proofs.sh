#!/usr/bin/env bash
# Copyright (c)  MageLens
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

# Native XML proof entry points and their helpers live alongside the host tests.
stage_xml_proofs() {
    cp tests/xml-*.php "$1/"
}

xml_proof() {
    local script=$1
    shift
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php "/application/docker/php/e2e/$script" "$@"
}

layout_proof() {
    local name=$1
    shift
    ./bin/application-compose exec -T -e MAGELENS_XML_HOOKS=/application/docker/php/xml-hooks.php phpfpm \
        php -d auto_prepend_file=/application/docker/php/e2e/xml-layout-early-hooks.php \
        "/application/docker/php/e2e/xml-layout-$name-proof.php" "$@"
}

layout_cases() {
    local name=$1 variant
    shift
    for variant in "$@"; do layout_proof "$name" "$variant"; done
}

prove_blog_controllers() {
    local action
    for action in index view; do
        xml_proof xml-layout-blog-constructor-proof.php "$action" "$@" --without-collector
        layout_proof blog-constructor "$action" "$@"
    done
}

prove_stock_admin_layout() (
    local artifacts=$1
    cleanup_stock_admin() {
        local result=$?
        ./bin/application-compose exec -T phpfpm php /application/docker/php/collection.php stop || result=1
        ./bin/application-compose exec -T phpfpm php bin/magento cache:enable layout || result=1
        exit "$result"
    }
    trap cleanup_stock_admin EXIT
    # Login can warm the theme's package cache before the Blog request.
    ./bin/application-compose exec -T phpfpm php bin/magento cache:disable layout
    ./bin/application-compose exec -T phpfpm php bin/magento cache:clean config
    ./bin/application-compose exec -T phpfpm php /application/docker/php/theme-scope.php > .runtime/active-themes.json
    ./bin/runner node bin/prepare.cjs --theme-roots .runtime/active-themes.json
    ./bin/application-compose exec -T phpfpm php /application/docker/php/xml-manifest.php
    ./bin/application-compose exec -T phpfpm php /application/docker/php/manifest.php
    ./bin/application-compose exec -T phpfpm php /application/docker/php/collection.php start
    ./bin/application-compose exec -T -e MAGELENS_ROUTING_COLLECT=1 runner \
        node --test --test-name-pattern='Blog Admin route' tests/verify-routing-native.cjs
    ./bin/application-compose exec -T phpfpm php /application/docker/php/collection.php stop
    ./bin/application-compose exec -T phpfpm php /application/docker/php/xml-manifest.php check
    ./bin/runner node bin/report-xml.cjs
    cp coverage/xml/coverage.json "$artifacts/stock-admin-xml.json"
    ./bin/runner node tests/verify-layout-admin.cjs coverage/xml/coverage.json adminhtml/MageOS/m137-admin-theme
)

run_xml_proofs() {
    local theme=$1 platform=$2 mode=$3
    mkdir -p coverage
    xml_proof xml-inventory-proof.php /var/www/html/vendor
    xml_proof xml-admin-navigation.test.php /var/www/html/vendor /source
    xml_proof xml-admin-navigation-acl-proof.php --without-collector
    xml_proof xml-admin-navigation-acl-proof.php
    xml_proof xml-layout-scope-bootstrap-proof.php
    local assets_without assets_with renderer
    for renderer in '' --custom-emission; do
        assets_without=$(layout_proof asset-passivity --without-collector ${renderer:+"$renderer"})
        assets_with=$(layout_proof asset-passivity ${renderer:+"$renderer"})
        if [[ "$assets_without" != "$assets_with" ]]; then
            diff -u <(printf '%s\n' "$assets_without") <(printf '%s\n' "$assets_with")
            return 1
        fi
    done
    printf 'Verified identical native asset output and getter calls with collection off and on.\n'
    layout_cases equal-mutation block offset-set offset-unset-restore
    xml_proof xml-layout-cache-scope.test.php

    for internal_bridge_mode in early late-closure late-property limit callback-error; do
        xml_proof xml-layout-internal-bridge.test.php "$internal_bridge_mode"
    done
    for internal_closure_mode in --without-collector ''; do
        xml_proof xml-internal-closure-hooks.test.php "$internal_closure_mode"
    done
    for internal_property_mode in --without-collector '' --late-registration; do
        xml_proof xml-internal-property-hooks.test.php "$internal_property_mode"
    done
    xml_proof xml-observers.test.php
    xml_proof xml-plugins.test.php
    for di_usage_case in proof collector collector-stale collector-gaps; do
        xml_proof xml-di-usage-hook-proof.php /var/www/html/vendor "$di_usage_case"
    done
    xml_proof xml-compiled-di-hook-proof.php
    for preference_case in cold warm stale-removed stale-retained stale-mutation broken-hook; do
        xml_proof xml-preferences.test.php /var/www/html/vendor "$preference_case"
    done
    if [[ "$platform" == mageos ]]; then
        xml_proof xml-plugins.test.php inline
        xml_proof xml-plugins.test.php inline stale-inline
    fi
    xml_proof xml-layout-bounds.test.php
    for registry_case in native missing-import missing-attribute missing-cdata stale limit; do
        xml_proof xml-layout-registry-hook-proof.php "$registry_case"
    done
    for ui_case in native custom-parser; do
        layout_proof ui-hook "$ui_case" --without-collector
    done
    layout_cases ui-hook native custom-parser missing-factory missing-key missing-decision missing-dynamic-key missing-dynamic-decision missing-magic dynamic-limit
    reader_cases=(native fallback plugin parser reader missing-reader)
    if [[ "$platform" == mageos ]]; then reader_cases+=(compiled-fallback compiled-plugin); fi
    layout_cases reader-hook "${reader_cases[@]}"
    merge_cases=(native theme-getter theme-context theme-context-limit missing-theme-area missing-theme-path unused-parser exposed reset document-limit string-plugin xml-plugin parser-plugin late-parser-plugin string-no-parent xml-no-parent package-no-parent opaque-update native-selection standard-selection-plugin selection-no-parent missing-string missing-document missing-package)
    if [[ "$platform" == mageos ]]; then merge_cases+=(compiled-selection); fi
    if [[ "$theme" == hyva ]]; then
        merge_cases+=(package-event package-event-disabled missing-event-manager missing-event-config missing-event-invoker missing-event-observer event-depth observer-depth)
    fi
    layout_cases merge-hook "${merge_cases[@]}"
    class_cases=(native native-production fallback factory object-manager manager-restore factory-fallback factory-plugin generator-plugin around no-parent missing-factory missing-creation missing-wrapper missing-creation-pre missing-creation-post missing-manager missing-manager-pre missing-manager-post manager-depth registration-limit missing-registration missing-block-process missing-render-path)
    if [[ "$platform" == mageos ]]; then class_cases+=(compiled-fallback compiled-generator-plugin compiled-factory-plugin compiled-around); fi
    layout_cases class-hook "${class_cases[@]}"
    for lazy_factory_mode in '' --lazy-manager --lazy-generator; do
        layout_proof factory-lazy "$lazy_factory_mode" --without-collector
        layout_proof factory-lazy "$lazy_factory_mode"
    done
    layout_proof factory-lazy --receiver-limit
    layout_proof shared-hook
    layout_proof render-hook --without-collector
    layout_proof render-hook
    for reference_case in native equal-schedule custom-block-reader custom-container-reader; do
        layout_proof reference-hook "$reference_case" --without-collector
        layout_proof reference-hook "$reference_case"
    done
    layout_cases reference-hook missing-block-reader missing-container-reader missing-child-writer missing-child-parent missing-child-lookup
    for reference_case in missing-structure missing-generator missing-removal missing-child-schedule missing-child-helper; do
        for reference_half in "" -pre -post; do
            layout_proof reference-hook "$reference_case$reference_half"
        done
    done
    layout_cases reference-hook structure-depth removal-depth generator-depth schedule-depth placement-depth
    property_baseline="$(layout_proof property-hook --without-collector)"
    printf '%s\n' "$property_baseline"
    property_reads="$(printf '%s\n' "$property_baseline" | sed -n 's/^Native property reads: //p')"
    if [[ -z "$property_reads" ]]; then
        echo "Missing native property read baseline" >&2
        exit 1
    fi
    layout_proof property-hook --expected-reads "$property_reads"
    dependency_baseline="$(layout_proof dependency-hook --without-collector)"
    printf '%s\n' "$dependency_baseline"
    dependency_reads="$(printf '%s\n' "$dependency_baseline" | sed -n 's/^Native dependency reads: //p')"
    if [[ -z "$dependency_reads" ]]; then
        echo "Missing native dependency read baseline" >&2
        exit 1
    fi
    layout_proof dependency-hook --expected-reads "$dependency_reads"
    for move_storage in hooked-storage custom-getter; do
        move_baseline="$(layout_proof move-hook "$move_storage" --without-collector)"
        printf '%s\n' "$move_baseline"
        if [[ ! "$move_baseline" =~ Native\ move\ storage/getter\ reads:\ ([0-9]+) ]]; then
            echo "Missing native move storage baseline" >&2
            exit 1
        fi
        move_reads="${BASH_REMATCH[1]}"
        layout_proof move-hook "$move_storage" --expected-reads "$move_reads"
    done
    xml_proof xml-layout-move-lazy-proof.php --without-collector
    xml_proof xml-layout-move-lazy-proof.php
    layout_cases move-hook native programmatic same unchanged sibling-missing alias-fallback overridden missing-writer missing-order missing-execution missing-list missing-reader missing-reader-entry missing-reader-end missing-order-pre missing-order-post missing-execution-pre missing-execution-post missing-schedule-pre missing-schedule-post reader-depth execution-depth interpret-depth custom-structure
    if [[ "$platform" == mageos ]]; then
        layout_proof shared-hook unverified-scope
    fi
    for controller_asset_options in '--without-collector' '--without-collector --custom-url' '' '--custom-url' '--missing-url-pre' '--missing-url-post'; do
        read -r -a controller_asset_args <<< "$controller_asset_options"
        layout_proof controller-asset "${controller_asset_args[@]}"
    done
    layout_cases metadata-hook native missing-api missing-attribute missing-label missing-type depth
    for selection_area in frontend adminhtml; do
        for selection_case in native missing-getter; do
            layout_proof selection-hook "$selection_area" "$selection_case"
        done
    done
    if [[ "$platform" == mageos ]]; then
        for selection_case in standard missing-plugin missing-condition missing-lookup; do
            layout_proof selection-hook adminhtml "$selection_case"
        done
    fi
    template_cases=(native unmapped unmapped-first getter file resolver engine engine-inherited engine-inherited-fallback fallback resolver-fallback engine-fallback getter-plugin file-plugin resolver-plugin engine-plugin around engine-around custom-theme-plugin missing-getter missing-file missing-resolver missing-getter-pre missing-getter-post missing-theme-plugin missing-plugin-lookup missing-engine missing-engine-pre missing-engine-post missing-engine-wrapper missing-engine-pool resolution-depth rendering-depth before-plugin-depth)
    if [[ "$theme" == hyva ]]; then template_cases+=(missing-engine-plugin missing-engine-lookup); fi
    if [[ "$platform" == mageos ]]; then template_cases+=(compiled-fallback compiled-resolver-fallback compiled-engine-fallback compiled-getter-plugin compiled-file-plugin compiled-resolver-plugin compiled-engine-plugin compiled-around compiled-engine-around); fi
    layout_cases template-hook "${template_cases[@]}"
    layout_proof falsy-hook --without-collector
    layout_proof falsy-hook
    layout_proof falsy-hook --zero-class-only
    layout_proof magic-action --without-collector
    layout_proof magic-action
    layout_proof argument-groups --without-collector
    argument_group_selector_calls=6
    [[ "$platform" != mageos ]] || argument_group_selector_calls=12
    layout_proof argument-groups --custom-selector --without-collector --selector-calls "$argument_group_selector_calls"
    for argument_group_mode in '' --custom-selector --missing-group-pre --missing-group-post --missing-parser --group-depth --group-node-limit; do
        layout_proof argument-groups "$argument_group_mode" --selector-calls "$argument_group_selector_calls"
    done
    layout_proof argument-fields --first-layout --without-collector
    for first_layout_mode in '' --missing-dispatch-pre --missing-dispatch-post --missing-first-dispatch-pre --missing-first-dispatch-post; do
        layout_proof argument-fields --first-layout "$first_layout_mode"
    done
    for first_foreign_mode in --without-collector '' --missing-native-first-pre --missing-native-first-post; do
        layout_proof argument-fields --first-layout --foreign-lookup "$first_foreign_mode"
    done
    layout_proof argument-fields --without-collector
    layout_cases argument-fields '' --missing-dispatch-pre --missing-dispatch-post --custom-dispatch --alternate-discriminator --custom-forwarder
    layout_proof argument-fields --service-url --without-collector
    layout_proof argument-fields --service-url
    for modifier_mode in '' --custom-dispatch --alternate-discriminator --custom-forwarder --missing-modifier-pre --missing-modifier-post --missing-modifier-both; do
        layout_proof argument-fields --modifier-fields "$modifier_mode"
    done
    for nested_type_native in '' --custom-items; do
        layout_proof argument-fields --nested-types "$nested_type_native" --without-collector
    done
    for nested_type_mode in '' --custom-items --missing-items-pre --missing-items-post; do
        layout_proof argument-fields --nested-types "$nested_type_mode"
    done
    layout_proof template-value --without-collector
    layout_proof template-value
    layout_proof direct-template --without-collector
    layout_proof direct-template
    for direct_template in --reflection --closure; do
        layout_proof direct-template --without-collector "$direct_template"
        layout_proof direct-template "$direct_template"
    done
    for scoped_definition in '' --block-defined; do
        for scoped_field in template data; do
            for scoped_method in bind bindTo call; do
                for scoped_collection in --without-collector ''; do
                    layout_proof scoped-closure "$scoped_field" "$scoped_method" "$scoped_collection" "$scoped_definition"
                done
            done
        done
    done
    for scoped_missing in bind bindTo call; do
        layout_proof scoped-closure template bind --missing-hook "$scoped_missing"
    done
    for reflection_stage in '' --during-generation; do
        for reflection_method in setValue setRawValue setRawValueWithoutLazyInitialization; do
            for reflection_field in template data; do
                for reflection_failure in '' --failed; do
                    for reflection_collection in --without-collector ''; do
                        layout_proof reflection-write "$reflection_field" --method "$reflection_method" "$reflection_failure" "$reflection_collection" "$reflection_stage"
                    done
                done
            done
        done
    done
    for reflection_field in template data; do
        for scoped_field in template data; do
        for scoped_method in bind bindTo call; do
            for scoped_collection in --without-collector ''; do
                layout_proof scoped-closure "$scoped_field" "$scoped_method" "$scoped_collection"
            done
        done
    done
    for scoped_missing in bind bindTo call; do
        layout_proof scoped-closure template bind --missing-hook "$scoped_missing"
    done
    for reflection_stage in '' --during-generation; do
            for reflection_collection in --without-collector ''; do
                layout_proof reflection-write "$reflection_field" "$reflection_stage" "$reflection_collection" --unmapped
            done
        done
    done
    for reflection_field in template data; do
        for reflection_outcome in success failed; do
            reflection_options=()
            [[ "$reflection_outcome" != failed ]] || reflection_options+=(--failed)
            layout_proof reflection-write "$reflection_field" "${reflection_options[@]}" --during-generation --evidence-file /tmp/magelens-reflection-proof.json
            ./bin/application-compose exec -T phpfpm cat /tmp/magelens-reflection-proof.json > .runtime/layout-reflection-proof.json
            ./bin/runner node tests/layout-reflection-report-proof.cjs "$reflection_field" "$reflection_outcome" .runtime/layout-reflection-proof.json
        done
    done
    layout_cases opaque-action --without-collector ''
    for action_type_option in --without-collector ''; do
        layout_proof argument-fields --action-types "$action_type_option"
    done
    for action_type_missing in --missing-action-dispatch-pre --missing-action-dispatch-post --missing-action-dispatch-both; do
        layout_proof argument-fields --action-types "$action_type_missing"
    done
    for metadata_case in '' --programmatic; do
        for metadata_collection in --without-collector ''; do
            layout_proof head-metadata "$metadata_case" "$metadata_collection"
        done
    done
    layout_cases page-falsy --without-collector '' --missing-removal-pre --missing-removal-post --missing-removal-both
    layout_cases configured-url --without-collector ''
    for configured_case in '' --action --nested-failure; do
        for configured_collection in --without-collector ''; do
            layout_proof configured-fields "$configured_case" "$configured_collection"
        done
    done
    layout_proof configured-fields --missing-create
    for named_parameter_option in --without-collector '' --custom-parameter-string; do
        layout_proof nested-modifiers --parameters "$named_parameter_option"
    done
    for named_parameter_missing in --missing-parameter-pre --missing-parameter-post --missing-parameter-both --missing-parameter-string-pre --missing-parameter-string-post --missing-parameter-string-both --missing-parameter-map-pre --missing-parameter-map-post --missing-parameter-map-both; do
        layout_proof nested-modifiers --parameters "$named_parameter_missing"
    done
    layout_cases nested-modifiers --without-collector ''
    for direct_data_variant in '' --external-writer --untouched; do
        layout_proof direct-data --without-collector ${direct_data_variant:+"$direct_data_variant"}
        layout_proof direct-data ${direct_data_variant:+"$direct_data_variant"}
    done
    for data_reference_mode in return alias foreach; do
        for data_reference_collection in --without-collector ''; do
            layout_proof data-reference "$data_reference_mode" "$data_reference_collection"
        done
    done
    for implementation_field in '' --data; do
        for template_field in clean literal variable braced foreign public hook reflection opaque edit symlink missing class-limit file-limit access-limit record-limit; do
            xml_proof xml-layout-template-field-proof.php "$template_field" "$implementation_field"
        done
    done
    layout_cases template-value --missing-constructor-pre --missing-constructor-post --missing-getter --missing-setter --missing-query --method-limit --method-name-limit
    layout_proof failed-action --without-collector
    layout_proof failed-action
    layout_cases failed-action --missing-action-pre --missing-action-post --missing-evaluation-pre --missing-evaluation-post --action-depth
    layout_proof failed-action --partial-only
    for action_interpreter in --missing-interpreter-pre --missing-interpreter-post; do
        layout_proof failed-action "$action_interpreter" --partial-only
    done
    for shared_case in guarded unguarded distinct; do
        layout_proof shared-action "$shared_case" --without-collector
        layout_proof shared-action "$shared_case"
    done
    layout_cases shared-action --alias-limit --binding-limit
    for shared_missing in --missing-process --missing-snapshot; do
        layout_proof shared-action unguarded "$shared_missing"
    done
    for storage_case in array-access object-error; do
        layout_proof argument-storage "$storage_case" --without-collector
        layout_proof argument-storage "$storage_case"
    done
    for callback_case in healthy pre post; do
        callback_result=$(layout_proof callback-health "$callback_case" 2>&1)
        printf '%s\n' "$callback_result"
        if [[ "$callback_result" == *'OpenTelemetry:'* || "$callback_result" == *'private-callback-payload'* ]]; then
            fail 'Layout callback failure escaped into native output.'
        fi
    done
    for callback_case in healthy throw depth trace-limit location; do
        xml_proof xml-layout-runtime-hooks.test.php "$callback_case"
    done
    for names_case in blocks move containers; do
        for names_collection in --without-collector ''; do
            names_options=()
            if [[ -n "$names_collection" ]]; then names_options+=("$names_collection"); fi
            names_result=$(layout_proof names-hook "$names_case" "${names_options[@]}" 2>&1)
            printf '%s\n' "$names_result"
            if [[ "$names_result" == *'OpenTelemetry:'* ]]; then fail 'Numeric layout names caused an instrumentation warning.'; fi
        done
    done
    for guard_case in native guard-only zero-hit unvisited-scope unguarded dynamic equal-write custom-snapshot snapshot-limit delegated-flag delegated-scope failed-flag; do
        guard_native=$(layout_proof action-guard "$guard_case" --without-collector)
        printf '%s\n' "$guard_native"
        guard_options=()
        if [[ "$guard_case" == custom-snapshot ]]; then
            guard_reads=$(printf '%s\n' "$guard_native" | sed -n 's/^Native action schedule reads: //p')
            [[ -n "$guard_reads" ]] || fail 'Missing native action schedule getter baseline.'
            guard_options=(--expected-reads "$guard_reads")
        fi
        layout_proof action-guard "$guard_case" "${guard_options[@]}"
    done
    for guard_observation in process snapshot scope flag; do
        for guard_side in '' -pre -post; do
            layout_proof action-guard "missing-$guard_observation$guard_side"
        done
        layout_proof action-guard "$guard_observation-depth"
    done
    for descriptor_case in native redeclared accessor hook magic; do
        descriptor_native=$(layout_proof file-descriptor-hook "$descriptor_case" --without-collector)
        printf '%s\n' "$descriptor_native"
        descriptor_reads=$(printf '%s\n' "$descriptor_native" | sed -n 's/^Native file-descriptor reads: //p')
        [[ -n "$descriptor_reads" ]]
        layout_proof file-descriptor-hook "$descriptor_case" --expected-reads "$descriptor_reads"
    done
    for file_list_case in native hook magic; do
        file_list_baseline=$(layout_proof file-list-hook "$file_list_case" --without-collector)
        printf '%s\n' "$file_list_baseline"
        file_list_reads=$(printf '%s\n' "$file_list_baseline" | sed -n 's/^Native file-list reads: //p')
        [[ -n "$file_list_reads" ]] || fail 'Missing native file-list getter baseline.'
        layout_proof file-list-hook "$file_list_case" --expected-reads "$file_list_reads"
    done
    for validation_case in native missing unset-dependencies override parent-override; do
        layout_proof template-validation-hook "$validation_case" --without-collector
    done
    layout_cases template-validation-hook native missing unset-dependencies override parent-override missing-pre missing-post missing-both
    for layout_cache_case in cold package merge schedule stale-provider; do
        layout_proof merge-cache "$layout_cache_case" --without-collector
        layout_proof merge-cache "$layout_cache_case" --evidence-file /tmp/magelens-layout-cache-proof.json
        ./bin/application-compose exec -T phpfpm cat /tmp/magelens-layout-cache-proof.json > .runtime/layout-cache-proof.json
        ./bin/runner node tests/layout-merge-cache-report-proof.cjs "$layout_cache_case" .runtime/layout-cache-proof.json
    done
    layout_cases cache-hook native equal ui missing-read missing-loader missing-pre missing-post depth
    xml_proof xml-config-theme-proof.php
    layout_cases page-cache-hook native warm equal missing-pre missing-post depth
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
        layout_proof class-hook empty-class
    )
    layout_cases argument-hook native reader generator missing-interpreter missing-reader missing-generator missing-action batch-depth interpreter-depth action-depth argument-limit
    (
        provider_proof() {
            layout_proof disabled-module "$@"
        }
        cleanup_provider_mode() {
            local result=$?
            trap - EXIT
            provider_proof --clear-output-disabled || result=1
            ./bin/application-compose exec -T phpfpm php bin/magento cache:clean config layout || result=1
            exit "$result"
        }
        trap cleanup_provider_mode EXIT
        trap 'exit 130' INT
        trap 'exit 143' TERM
        provider_proof --without-collector --enabled
        provider_proof --enabled
        provider_proof --set-output-disabled
        ./bin/application-compose exec -T phpfpm php bin/magento cache:clean config layout
        provider_proof --without-collector --output-disabled
        provider_proof --output-disabled
        ./bin/application-compose exec -T phpfpm php bin/magento module:disable MageLens_LayoutDisabled
        provider_proof --clear-output-disabled
        ./bin/application-compose exec -T phpfpm php bin/magento cache:clean config layout
        provider_proof --without-collector
        provider_proof
        provider_proof --without-collector --unvisited
        provider_proof --unvisited
        for provider_missing in --missing-filter-pre --missing-filter-post --missing-filter-candidates; do
            provider_proof "$provider_missing"
        done
    )
}

run_ui_component_proofs() (
    local proof=xml-ui-native-proof.php app=/var/www/html run baseline collected warmed cache_only
    local admin_design=src/app/design/adminhtml
    local composer_theme=src/vendor/magelens/ui-composer-proof
    if [[ -d .runtime/app/design/adminhtml ]]; then admin_design=.runtime/app/design/adminhtml; fi
    local local_theme="$admin_design/MageLens/ui-proof"
    run=$(./bin/application-compose exec -T phpfpm php -r 'echo bin2hex(random_bytes(16));')
    cleanup_ui_proof() {
        local result=$?
        trap - EXIT
        xml_proof "$proof" "$app" --clear-fixture-cache || result=1
        rm -rf -- "coverage/raw/xml-ui/$run" "$local_theme" "$composer_theme"
        exit "$result"
    }
    [[ ! -e "$local_theme" && ! -e "$composer_theme" ]] || fail 'Native UI theme fixture paths already exist.'
    trap cleanup_ui_proof EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    mkdir -p "$local_theme" "$composer_theme"
    cp -a tests/fixtures/ui-module/themes/local/. "$local_theme/"
    cp -a tests/fixtures/ui-module/themes/composer/. "$composer_theme/"
    xml_proof "$proof" "$app" --clear-fixture-cache
    baseline=$(xml_proof "$proof" "$app") || { printf "%s\n" "$baseline" >&2; return 1; }
    cache_only=$(xml_proof "$proof" "$app" --expect-cache-only "$run") || { printf "%s\n" "$cache_only" >&2; return 1; }
    xml_proof "$proof" "$app" --clear-fixture-cache
    collected=$(xml_proof "$proof" "$app" --collect "$run") || { printf "%s\n" "$collected" >&2; return 1; }
    warmed=$(xml_proof "$proof" "$app" --collect-warm "$run") || { printf "%s\n" "$warmed" >&2; return 1; }
    ./bin/runner node tests/verify-ui-native-report.cjs "coverage/raw/xml-ui/$run"
    [[ "$baseline" == "$cache_only" && "$baseline" == "$collected" && "$baseline" == "$warmed" ]] \
        || fail 'Collection changed native UI output or provider calls.'
    printf 'Verified native Admin UI output, provider calls, original lines and cache ownership.\n'
)
