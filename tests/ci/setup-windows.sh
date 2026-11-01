#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

# Invoked as root inside WSL2 on the actual windows-latest hosted VM.
set -euo pipefail
repository=$1
sha=$2
[[ "$repository" == MageLens/MageLens && "$sha" =~ ^[0-9a-f]{40}$ ]]
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends docker.io docker-compose-v2 git wget curl ca-certificates xz-utils
# The harness must run with a non-root application UID.
if ! id magelens >/dev/null 2>&1; then useradd --create-home --shell /bin/bash magelens; fi
usermod -aG docker magelens
service docker start
mkdir -p /tmp/magelens-ci
chown magelens:magelens /tmp/magelens-ci
# Host Node runs orchestration only; application Node remains pinned by dependencies.yaml.
curl -fsSL https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz -o /tmp/magelens-node.tar.xz
curl -fsSL https://nodejs.org/dist/v24.22.1/SHASUMS256.txt -o /tmp/magelens-node-shas
(cd /tmp; mv magelens-node.tar.xz node-v24.22.1-linux-x64.tar.xz; grep ' node-v24.22.1-linux-x64.tar.xz$' magelens-node-shas | sha256sum -c -; tar -xJf node-v24.22.1-linux-x64.tar.xz --strip-components=1 -C /usr/local; rm node-v24.22.1-linux-x64.tar.xz magelens-node-shas)
git init /home/magelens/project
git -C /home/magelens/project remote add origin "https://github.com/$repository.git"
git -C /home/magelens/project fetch --depth=1 origin "$sha"
git -C /home/magelens/project checkout --detach FETCH_HEAD
[[ "$(git -C /home/magelens/project rev-parse HEAD)" == "$sha" ]]
chown -R magelens:magelens /home/magelens/project
