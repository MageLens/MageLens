#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
# Standard images may contain large SDKs that MageLens does not use. This is
# restricted to disposable GitHub-hosted Linux VMs; never prune Docker resources.
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "$RUNNER_OS" == Linux ]]
df -h "$RUNNER_TEMP" /var/lib/docker
sudo rm -rf /usr/local/lib/android /usr/share/dotnet /opt/ghc /opt/hostedtoolcache/CodeQL
mkdir -p "$RUNNER_TEMP/magelens-e2e-tmp"
df -h "$RUNNER_TEMP" /var/lib/docker
