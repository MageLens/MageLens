#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
case "$(dpkg --print-architecture)" in
    amd64) platform=linux64; checksum=$CHROME_LINUX_X64_SHA256 ;;
    arm64) platform=linux-arm64; checksum=$CHROME_LINUX_ARM64_SHA256 ;;
    *) echo 'Chrome for Testing requires an amd64 or arm64 Linux image.' >&2; exit 1 ;;
esac
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
curl --fail --location --max-time 300 \
    "https://storage.googleapis.com/chrome-for-testing-public/$CHROME_VERSION/$platform/chrome-$platform.zip" \
    -o "$archive"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check
mkdir -p /opt/google
unzip -q "$archive" -d /opt/google
mv "/opt/google/chrome-$platform" /opt/google/chrome
ln -s /opt/google/chrome/chrome /usr/local/bin/chrome
chmod -R a+rX /opt/google/chrome
actual_version=$(chrome --version)
[[ "$actual_version" =~ ^Google\ Chrome\ for\ Testing\ ([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)[[:space:]]*$ ]]
[[ "${BASH_REMATCH[1]}" == "$CHROME_VERSION" ]]
