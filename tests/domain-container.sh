#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
source "$(dirname "$0")/../bin/common"
scratch=$(mktemp -d /tmp/magelens-domain-check.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
cat > "$scratch/check.sh" <<'BASH'
set -euo pipefail
script=/application/docker/php/base-url.sh
[[ "$(bash "$script" --print)" == https://store.magelens.test:8443/ ]]
[[ "$(bash "$script" --print-viewer)" == https://store.magelens.test:6090/ ]]
[[ "$(bash "$script")" == https://store.magelens.test:8443/ ]]
php -r '$c = require "/application/docker/php/env.php.sample"; if ($c["system"]["default"]["web"]["secure"]["base_url"] !== "https://store.magelens.test:8443/") exit(1);'
unset APPLICATION_DOMAIN APPLICATION_HTTPS_PORT
[[ "$(bash "$script" --print)" == https://magelens.test/ ]]
echo 'PASS: selected domain and ports match the explicit HTTPS configuration.'
BASH
docker run --rm --user "$LOCAL_UID:$LOCAL_GID" \
    --mount "type=bind,source=$scratch,target=/var/www/html" \
    --mount "type=bind,source=$ROOT/docker,target=/application/docker,readonly" \
    --env APPLICATION_DOMAIN=store.magelens.test --env APPLICATION_HTTPS_PORT=8443 --env CYPRESS_VIEW_PORT=6090 \
    --entrypoint bash "magelens-php:${MAGENTO_VERSION}-php${PHP_VERSION}-pcov${PCOV_VERSION}-markshust${MARKSHUST_DOCKER_MAGENTO_VERSION}" \
    /var/www/html/check.sh
