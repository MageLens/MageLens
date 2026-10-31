#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
cd /var/www/html
# Clear copied/instrumented assets; developer mode generates requested files on demand.
# Keep .htaccess and the deployment version in pub/static.
rm -rf pub/static/frontend pub/static/adminhtml var/view_preprocessed
php bin/magento cache:clean
