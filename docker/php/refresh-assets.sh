#!/usr/bin/env bash
# Copyright (c)  MageLens
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
cd /var/www/html
mode=$(php -r 'require "app/bootstrap.php"; echo Magento\Framework\App\Bootstrap::create(BP, $_SERVER)
    ->getObjectManager()->get(Magento\Framework\App\State::class)->getMode();')
# Keep .htaccess and the deployment version in pub/static.
rm -rf pub/static/frontend pub/static/adminhtml var/view_preprocessed
if [[ "$mode" == production ]]; then
    php bin/magento setup:static-content:deploy
fi
php bin/magento cache:clean
