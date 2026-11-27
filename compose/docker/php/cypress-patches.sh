#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
# Patch paths are relative to the Composer-installed Magento project.
case "${1:-}" in
    apply|revert) ;;
    *) printf 'Usage: cypress-patches.sh apply|revert\n' >&2; exit 2 ;;
esac
cd "${MAGENTO_ROOT:-/var/www/html}"
patches=${CYPRESS_PATCHES_DIR:-/cypress-patches}
# Mage-OS keeps Magento's PHP namespaces but installs its framework under mage-os/.
apply_patch() {
    local file=$1
    shift
    if [[ -f vendor/mage-os/framework/Component/ComponentRegistrar.php ]]; then
        sed 's|vendor/magento/framework/|vendor/mage-os/framework/|g' "$file"
    else
        cat "$file"
    fi | git apply --unidiff-zero "$@"
}
# Retired workarounds must never be reapplied, including after an interrupted run.
for patch in "$patches"/retired/*.patch; do
    [[ -f "$patch" ]] || continue
    if apply_patch "$patch" --reverse --check 2>/dev/null; then
        apply_patch "$patch" --reverse
        printf 'Restored retired Cypress-only patch: %s\n' "$(basename "$patch")"
    elif ! apply_patch "$patch" --check 2>/dev/null; then
        printf 'Cannot safely restore retired patch %s; inspect the Magento file before continuing.\n' "$patch" >&2
        exit 1
    fi
done
for patch in "$patches"/*.patch; do
    [[ -f "$patch" ]] || continue
    # Extracting a release over an older checkout can leave its former active copy.
    [[ ! -f "$patches/retired/$(basename "$patch")" ]] || continue
    case "${1:-}" in
        apply)
            if apply_patch "$patch" --check 2>/dev/null; then
                apply_patch "$patch"
                printf 'Applied Cypress-only patch: %s\n' "$(basename "$patch")"
            elif apply_patch "$patch" --reverse --check 2>/dev/null; then
                printf 'Cypress-only patch already applied: %s\n' "$(basename "$patch")"
            else
                printf 'Patch does not match this Magento version: %s. Review it before running Cypress.\n' "$patch" >&2
                exit 1
            fi
            ;;
        revert)
            if apply_patch "$patch" --reverse --check 2>/dev/null; then
                apply_patch "$patch" --reverse
            elif ! apply_patch "$patch" --check 2>/dev/null; then
                printf 'Cannot safely restore %s; inspect the Magento file before continuing.\n' "$patch" >&2
                exit 1
            fi
            ;;
    esac
done
