#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.
set -euo pipefail
bash /opt/magelens/desktop.sh >/tmp/magelens-cookie-desktop.log 2>&1 &
for attempt in {1..30}; do
    if node /opt/magelens/healthcheck.cjs; then break; fi
    sleep 1
done
node /opt/magelens/healthcheck.cjs
# The fixture runs in the same common harness as full installation qualification.
node tests/cypress-regressions.cjs
