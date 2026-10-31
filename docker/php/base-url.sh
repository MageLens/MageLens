#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
cd /var/www/html
url="https://${APPLICATION_DOMAIN:-magelens.test}"
[[ "${APPLICATION_HTTPS_PORT:-443}" == 443 ]] || url+=":${APPLICATION_HTTPS_PORT}"
url+='/'
if [[ "${1:---print}" == --print ]]; then
    printf '%s\n' "$url"
    exit 0
fi
if [[ "${1:-}" == --print-viewer ]]; then
    printf 'https://%s:%s/\n' "${APPLICATION_DOMAIN:-magelens.test}" "${RUNNER_VIEW_PORT:-${CYPRESS_VIEW_PORT:-6080}}"
    exit 0
fi
printf 'Usage: base-url.sh [--print|--print-viewer]\n' >&2
exit 2
