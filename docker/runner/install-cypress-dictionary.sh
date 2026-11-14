#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
# Cypress 16.3.0 bundles Electron 43.8.4. Electron initializes Hunspell even
# with webPreferences.spellcheck=false (electron/electron#22995). Package the
# Cypress controller's English dictionary before any test traffic. The
# application under test runs in Chrome; Cypress itself still uses Electron.
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
curl --fail --location --max-time 120 \
    https://github.com/electron/electron/releases/download/v43.8.4/hunspell_dictionaries.zip \
    -o "$archive"
echo "de20757ddf84cb2b419ebc88957ae195b0a8afdc415b081bbf1ebf9660220d6b  $archive" | sha256sum --check
mkdir -p /opt/magelens/dictionaries
unzip -q "$archive" 'en-US-10-1.bdic' 'COPYING*' LICENSE -d /opt/magelens/dictionaries
