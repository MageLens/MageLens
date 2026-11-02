#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.
set -euo pipefail
bash /opt/magelens/desktop.sh >/evidence/desktop.log 2>&1 &
node tests/ci/cookie-diagnosis.cjs >/evidence/fixture.log 2>&1 &
for attempt in {1..30}; do
    if node /opt/magelens/healthcheck.cjs && curl --fail --silent http://localhost:8123/start >/dev/null; then break; fi
    sleep 1
done
node /opt/magelens/healthcheck.cjs
node tests/ci/packaged-cookie.cjs
