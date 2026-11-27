#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
platform=${MAGELENS_PLATFORM:-magento}
version=${MAGELENS_PLATFORM_VERSION:-$MAGENTO_VERSION}
case "$platform" in
    magento) repository=https://repo.magento.com/; package=magento/project-community-edition; framework=magento ;;
    mageos) repository=https://repo.mage-os.org/; package=mage-os/project-community-edition; framework=mage-os ;;
    *) echo "Unsupported platform: $platform" >&2; exit 1 ;;
esac
stage="/bootstrap/$platform-$version"
if [[ -f "$stage/.magelens-composer-ready" ]] && \
    composer --working-dir="$stage" show markshust/magento2-module-disabletwofactorauth >/dev/null 2>&1; then
    exit 0
fi
rm -f "$stage/.magelens-composer-ready"
if [[ ! -f "$stage/composer.json" ]]; then
    # Stage the download because src/ may already hold client code and data.
    composer create-project --repository="$repository" \
        "$package=$version" "$stage" --no-install --no-interaction
fi
cd "$stage"
# Composer caches successful archives even when another HTTP transfer fails.
# Retry transport failures without repeating dependency-resolution errors.
for attempt in 1 2 3; do
    if composer install --prefer-dist --no-interaction --no-progress; then
        break
    else
        status=$?
        (( status == 100 && attempt < 3 )) || exit "$status"
        printf 'Package download interrupted; retrying Composer (%s/3).\n' "$((attempt + 1))" >&2
    fi
done
bash /application/docker/php/install-dev-tools.sh
[[ -f vendor/$framework/framework/Component/ComponentRegistrar.php && ! -d app/code/Magento ]] || {
    echo "Expected Composer-installed $platform packages in vendor/$framework." >&2; exit 1;
}
php /application/docker/php/sync-source.php inventory "$stage"
touch .magelens-composer-ready
