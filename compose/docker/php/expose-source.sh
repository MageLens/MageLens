#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
# nginx keeps its upstream UID; PHP owns the shared private socket directory.
chown "$APPLICATION_UID:$APPLICATION_GID" /sock
cd /var/www/html
source_tree="/bootstrap/${MAGELENS_PLATFORM:-magento}-${MAGELENS_PLATFORM_VERSION:-$MAGENTO_VERSION}"
if [[ -f composer.json ]]; then
    php /application/docker/php/sync-source.php check-platform /var/www/html "${MAGELENS_PLATFORM:-magento}"
fi
if [[ ! -f .application-source-ready ]]; then
    if [[ -f composer.json && ! -f .application-source-copying ]]; then
        # An existing project owns its source and Composer lock. Never
        # overlay the bootstrapped project or take ownership of its files.
        [[ -f bin/magento && -f app/bootstrap.php && -f composer.lock ]] || {
            echo 'Expected a complete Magento or Mage-OS project in src/ (composer.json, composer.lock, bin/magento, app/bootstrap.php).' >&2; exit 1;
        }
        touch .magelens-imported .application-source-ready
        chown "$APPLICATION_UID:$APPLICATION_GID" .magelens-imported .application-source-ready
    else
        if [[ ! -f .application-source-copying ]]; then
            # A clean checkout may already contain any custom modules and themes.
            # Refuse any other pre-existing tree; never overwrite an unrelated install.
            while IFS= read -r -d '' entry; do
                case "$entry" in
                    .|./app)
                        [[ -d "$entry" && ! -L "$entry" ]] && continue ;;
                esac
                echo "Unrecognized file in src/: $entry. Move unrelated files aside before rerunning ./install.sh." >&2
                exit 1
            done < <(find . \( -path ./app/code -o -path ./app/design \) -prune -o -print0)
            # Record the origin before copying, so an interrupted copy can be resumed.
            if [[ -f /legacy/.application-source-ready ]]; then
                printf '/legacy\n' > .application-source-copying
            else
                printf '%s\n' "$source_tree" > .application-source-copying
            fi
        fi
        origin=$(cat .application-source-copying)
        # An interrupted older bootstrap can restart from the Composer tree.
        [[ "$origin" != /opt/magento ]] || origin="$source_tree"
        [[ "$origin" == /legacy || "$origin" == "$source_tree" ]] || { echo 'Invalid source copy state.' >&2; exit 1; }
        [[ -f "$source_tree/.magelens-composer-ready" ]] || { echo 'Complete the Composer download before exposing source.' >&2; exit 1; }
        echo "Copying application source from $origin into the host src/ directory."
        rsync -a --ignore-existing --exclude=/.application-source-ready --exclude=/.application-source-copying --exclude=/.magelens-composer-ready "$origin/" ./
        chown -R "$APPLICATION_UID:$APPLICATION_GID" .
        touch .application-source-ready
        chown "$APPLICATION_UID:$APPLICATION_GID" .application-source-ready
        rm .application-source-copying
    fi
fi
if [[ -f .magelens-imported ]]; then
    echo 'Using the copied project and its Composer lock; managed source updates are disabled.'
else
    [[ -f "$source_tree/.magelens-composer-ready" ]] || { echo 'Complete the Composer download before updating source.' >&2; exit 1; }
    su -s /bin/bash app -c 'exec php /application/docker/php/sync-source.php sync "$1" /var/www/html' -- bash "$source_tree"
fi
echo 'Application core, vendor, configuration and media are available in src/.'
