#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
apt-get update
apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify openbox x11-utils x11-xserver-utils
rm -rf /var/lib/apt/lists/*
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix
