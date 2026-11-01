#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
# Cypress 16.2.1 bundles Electron 41.7.0. Electron initializes Hunspell even
# with webPreferences.spellcheck=false (electron/electron#22995). Package the
# runner's English dictionary as a browser dependency, before any test traffic.
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
curl --fail --location --max-time 120 \
    https://github.com/electron/electron/releases/download/v41.7.0/hunspell_dictionaries.zip \
    -o "$archive"
echo "e457ba2db5f18d7405baa8cc2caf065377932d406ac9415ff8817f956bc6fea3  $archive" | sha256sum --check
mkdir -p /opt/magelens/dictionaries
unzip -q "$archive" 'en-US-10-1.bdic' 'COPYING*' LICENSE -d /opt/magelens/dictionaries
