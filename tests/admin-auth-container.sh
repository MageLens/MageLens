#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
source "$(dirname "$0")/../bin/common"
preflight
scratch=$(mktemp -d /tmp/magelens-admin-auth.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bootstrap/magento-$MAGENTO_VERSION" "$scratch/source"
# A minimal Composer project exercises the real development dependency without
# downloading Magento or requiring Marketplace credentials.
cat > "$scratch/bootstrap/magento-$MAGENTO_VERSION/composer.json" <<JSON
{"name":"magelens/auth-integration-check","version":"$MAGENTO_VERSION","replace":{"magento/framework":"103.0.8"}}
JSON
cat > "$scratch/check.sh" <<'BASH'
set -euo pipefail
stage="/bootstrap/magento-$MAGENTO_VERSION"
cd "$stage"
composer install --no-interaction --no-progress
# Represent the framework file checked by the downloader in this minimal fixture.
mkdir -p vendor/magento/framework/Component
printf '<?php\n' > vendor/magento/framework/Component/ComponentRegistrar.php
php /application/docker/php/sync-source.php inventory "$stage"
touch .magelens-composer-ready
cp -a . /var/www/html/
bash /application/docker/php/download-magento.sh
php -r '
    $c = json_decode(file_get_contents("composer.json"), true);
    $i = json_decode(file_get_contents(".magelens-source.json"), true);
    if (!isset($c["require-dev"]["markshust/magento2-module-disabletwofactorauth"])) exit(1);
    if (!isset($i["files"]["vendor/markshust/magento2-module-disabletwofactorauth/registration.php"])) exit(1);
    if (!is_file(".magelens-composer-ready")) exit(1);
'
php /application/docker/php/sync-source.php sync "$stage" /var/www/html
cmp composer.json /var/www/html/composer.json
cmp composer.lock /var/www/html/composer.lock
test -f /var/www/html/vendor/markshust/magento2-module-disabletwofactorauth/registration.php
sha256sum composer.json composer.lock .magelens-source.json > /tmp/managed-before
bash /application/docker/php/download-magento.sh
sha256sum -c /tmp/managed-before
cd /var/www/html
sha256sum composer.json composer.lock > /tmp/project-before
bash /application/docker/php/install-dev-tools.sh
sha256sum -c /tmp/project-before
echo 'PASS: a ready Magento download receives the dev dependency, syncs it into vendor, and preserves Composer locks on reruns.'
BASH
docker run --rm --user "$LOCAL_UID:$LOCAL_GID" --env MAGENTO_VERSION \
    --mount "type=bind,source=$scratch/bootstrap,target=/bootstrap" \
    --mount "type=bind,source=$scratch/source,target=/var/www/html" \
    --mount "type=bind,source=$scratch/check.sh,target=/check.sh,readonly" \
    --mount "type=bind,source=$ROOT/docker,target=/application/docker,readonly" \
    --entrypoint bash "magelens-php:${MAGENTO_VERSION}-php${PHP_VERSION}-pcov${PCOV_VERSION}-markshust${MARKSHUST_DOCKER_MAGENTO_VERSION}" /check.sh
