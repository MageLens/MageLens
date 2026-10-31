#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
cd /var/www/html
[[ -f .application-source-ready ]] || { echo 'Magento source is missing from src/. Rerun ./install.sh.' >&2; exit 1; }
as_app() { su -s /bin/bash app -c 'cd /var/www/html; exec "$@"' -- bash "$@"; }
if [[ -f .magelens-imported ]]; then
    as_app composer install --prefer-dist --no-interaction --no-progress
    as_app bash /application/docker/php/install-dev-tools.sh
    # Copied credentials must not make setup:upgrade connect to a remote shop.
    as_app php -r '
        if (is_file("app/etc/env.php")) {
            $env = require "app/etc/env.php";
            if (($env["db"]["connection"]["default"]["host"] ?? "") !== "db") {
                fwrite(STDERR, "Point src/app/etc/env.php at this local db service and import your database, or move env.php aside for a fresh local installation.\n");
                exit(1);
            }
        }'
fi
if [[ ! -f app/etc/env.php ]]; then
    as_app php bin/magento setup:install \
        --base-url="$(bash /application/docker/php/base-url.sh --print)" \
        --base-url-secure="$(bash /application/docker/php/base-url.sh --print)" --db-host=db --db-name=magento \
        --db-user=magento --db-password=magento --backend-frontname=admin \
        --admin-firstname=Application --admin-lastname=Developer --admin-email=application@example.test \
        --admin-user=application --admin-password=ApplicationOnly123456! --language=en_US \
        --currency=USD --timezone=UTC --use-rewrites=1 --search-engine=opensearch \
        --opensearch-host=opensearch --opensearch-port=9200 \
        --session-save=files --cache-backend=redis --cache-backend-redis-server=redis \
        --cache-backend-redis-db=0 --no-interaction
fi
modules=$(as_app php /application/docker/php/project.php)
if [[ -n "$modules" ]]; then
    mapfile -t new_modules <<< "$modules"
    as_app php bin/magento module:enable "${new_modules[@]}"
fi
as_app php bin/magento module:enable MarkShust_DisableTwoFactorAuth
as_app php bin/magento setup:upgrade
as_app php /application/docker/php/configure-env.php
as_app php bin/magento app:config:import --no-interaction
as_app php bin/magento cache:clean config
as_app php /application/docker/php/configure-theme.php
as_app php /application/docker/php/configure-admin.php
as_app php bin/magento indexer:reindex
