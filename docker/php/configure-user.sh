#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
groupmod -o -g "$APPLICATION_GID" app
usermod -o -u "$APPLICATION_UID" -g "$APPLICATION_GID" app
chown -R app:app /var/www
