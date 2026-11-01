#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
if [[ "$RUNNER_OS" == macOS ]]; then export CI_HOST_RUNTIME=VZ; fi
if [[ "$RUNNER_OS" != Windows ]]; then
    # Ubuntu 26 can mount /tmp on RAM. Installations must live on the runner disk.
    export MAGELENS_TEST_TMPDIR="$RUNNER_TEMP/magelens-e2e-tmp"
    mkdir -p "$MAGELENS_TEST_TMPDIR"
    exec "$@"
fi
# Keep the Windows host identity and image facts. Commands execute in its local
# WSL2 VM, never on a different Linux Actions runner or remote Docker server.
export MSYS_NO_PATHCONV=1
summary=$(wsl.exe --distribution Ubuntu-24.04 --exec wslpath -u "$GITHUB_STEP_SUMMARY")
host_workspace=$(wsl.exe --distribution Ubuntu-24.04 --exec wslpath -u "$(pwd -W)")
result=0
wsl.exe --distribution Ubuntu-24.04 --user magelens --exec env \
    CI_SHA="$CI_SHA" CI_CASE="$CI_CASE" CI_STEPS="${CI_STEPS:-}" \
    RUNNER_OS=Windows CI_HOST_RUNTIME=WSL2 RUNNER_TEMP=/tmp/magelens-ci MAGELENS_TEST_TMPDIR=/home/magelens/e2e-tmp \
    ImageOS="$ImageOS" ImageVersion="$ImageVersion" \
    GITHUB_RUN_ID="$GITHUB_RUN_ID" GITHUB_RUN_ATTEMPT="$GITHUB_RUN_ATTEMPT" \
    GITHUB_STEP_SUMMARY="$summary" MAGELENS_CI_HOST_PATH="$host_workspace" \
    MAGELENS_E2E_PLATFORM="$MAGELENS_E2E_PLATFORM" MAGELENS_E2E_THEME="$MAGELENS_E2E_THEME" MAGELENS_E2E_RUNNER="$MAGELENS_E2E_RUNNER" \
    MAGELENS_E2E_RESULT_FILE=/tmp/magelens-ci/magelens-result \
    MAGELENS_E2E_RESOURCE_FILE=/tmp/magelens-ci/magelens-resource \
    bash -c 'mkdir -p "$MAGELENS_TEST_TMPDIR"; cd /home/magelens/project; exec "$@"' bash "$@" || result=$?
# Copy only allowlisted evidence into the host checkout for upload-artifact.
if [[ "$1" == node && "$2" == tests/ci/evidence.cjs ]]; then
    wsl.exe --distribution Ubuntu-24.04 --user magelens --exec \
        cp -R /home/magelens/project/ci-reports "$host_workspace/"
fi
exit "$result"
