#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
source "$(dirname "$0")/../bin/common"
preflight
scratch=$(mktemp -d /tmp/magelens-adoption.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
expose() {
    docker run --rm --user root --env APPLICATION_UID="$LOCAL_UID" --env APPLICATION_GID="$LOCAL_GID" \
        --env MAGENTO_VERSION \
        --mount "type=bind,source=$1,target=/var/www/html" \
        --mount "type=bind,source=$ROOT/docker,target=/application/docker,readonly" \
        --mount "type=bind,source=$scratch/packages,target=/bootstrap,readonly" \
        --entrypoint bash "magelens-php:${MAGENTO_VERSION}-php${PHP_VERSION}-pcov${PCOV_VERSION}-markshust${MARKSHUST_DOCKER_MAGENTO_VERSION}" \
        -c 'mkdir -p /sock; exec bash /application/docker/php/expose-source.sh'
}
mkdir -p "$scratch/packages/magento-$MAGENTO_VERSION/bin"
# A minimal Composer project is sufficient to test source adoption without credentials.
printf '{"name":"magento/project-community-edition","require":{"magento/product-community-edition":"%s"}}\n' "$MAGENTO_VERSION" > "$scratch/packages/magento-$MAGENTO_VERSION/composer.json"
printf '<?php // package entry point\n' > "$scratch/packages/magento-$MAGENTO_VERSION/bin/magento"
docker run --rm --user "$LOCAL_UID:$LOCAL_GID" \
    --mount "type=bind,source=$scratch/packages,target=/bootstrap" \
    --mount "type=bind,source=$ROOT/docker,target=/application/docker,readonly" \
    --entrypoint php "magelens-php:${MAGENTO_VERSION}-php${PHP_VERSION}-pcov${PCOV_VERSION}-markshust${MARKSHUST_DOCKER_MAGENTO_VERSION}" \
    /application/docker/php/sync-source.php inventory "/bootstrap/magento-$MAGENTO_VERSION"
touch "$scratch/packages/magento-$MAGENTO_VERSION/.magelens-composer-ready"
mkdir -p "$scratch/import/bin" "$scratch/import/app"
printf '{"name":"customer/project","require":{}}\n' > "$scratch/import/composer.json"
printf '{"packages":[]}\n' > "$scratch/import/composer.lock"
printf '<?php // customer entry point\n' > "$scratch/import/bin/magento"
printf '<?php // customer bootstrap\n' > "$scratch/import/app/bootstrap.php"
cp -a tests/fixtures/todo/module "$scratch/todo"
mkdir -p "$scratch/import/app/code/Vitalii"
cp -a "$scratch/todo" "$scratch/import/app/code/Vitalii/TodoList"
before=$(sha256sum "$scratch/import/composer.json" "$scratch/import/composer.lock" "$scratch/import/bin/magento" "$scratch/import/app/code/Vitalii/TodoList/registration.php")
expose "$scratch/import"
expose "$scratch/import"
[[ -f "$scratch/import/.magelens-imported" && ! -f "$scratch/import/.magelens-source.json" ]]
[[ "$before" == "$(sha256sum "$scratch/import/composer.json" "$scratch/import/composer.lock" "$scratch/import/bin/magento" "$scratch/import/app/code/Vitalii/TodoList/registration.php")" ]]
printf 'PASS: adopting and rerunning a copied project preserves its Composer files and custom source.\n'
mkdir -p "$scratch/bootstrap/app/code/Vitalii"
cp -a "$scratch/todo" "$scratch/bootstrap/app/code/Vitalii/TodoList"
expose "$scratch/bootstrap"
[[ -f "$scratch/bootstrap/.application-source-ready" && ! -f "$scratch/bootstrap/.magelens-imported" ]]
[[ -f "$scratch/bootstrap/bin/magento" ]]
diff -r "$scratch/todo" "$scratch/bootstrap/app/code/Vitalii/TodoList"
printf 'PASS: bootstrapping around a pasted namespace preserves it without requiring the demo.\n'
