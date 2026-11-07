#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
cd "$(dirname "$0")/../.."
[[ $# == 1 && -d "$1" ]] || { echo 'Usage: tests/ci/branching.sh OWNED_COW_DIRECTORY' >&2; exit 1; }
root=$(pwd -P)
cow=$(realpath -e "$1")
image=$(./bin/branching-image playwright --build-from-source)
[[ ! -e ci-reports/branching ]] || { echo 'Branching reports must start empty.' >&2; exit 1; }
mkdir -p "$root/.runtime"
output=$(mktemp -d "$root/.runtime/branching-ci.XXXXXX")
dashboard_output="$output/dashboard"
collect_reports() {
    local result=$?
    trap - EXIT
    mkdir -p ci-reports/branching
    if [[ -f "$output/provider.json" ]]; then cp "$output/provider.json" ci-reports/branching/; fi
    if [[ -f "$dashboard_output/coverage/qualification.json" ]]; then
        cp "$dashboard_output/coverage/qualification.json" ci-reports/branching/dashboard.json
    fi
    if [[ -f "$dashboard_output/rust-coverage/summary.json" ]]; then
        cp "$dashboard_output/rust-coverage/summary.json" ci-reports/branching/rust.json
    fi
    node tests/ci/artifact-size.cjs ci-reports/branching || result=1
    exit "$result"
}
trap collect_reports EXIT
# Real Chrome, MariaDB, file/session snapshots and browser storage restoration.
# The fixture owns and removes its database container; no application is reused.
docker pull mariadb:11.4
docker run --rm --init --network none --memory 2g --memory-swap 2g --shm-size 512m \
    --env NODE_PATH=/workspace/node_modules \
    --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
    --mount "type=bind,source=$root,target=/driver,readonly" \
    --mount "type=bind,source=$cow,target=$cow" \
    --mount "type=bind,source=$output,target=/artifacts" \
    --workdir /driver --entrypoint node "$image" tests/branching-browser.cjs "$cow" /artifacts/provider.json
bash tests/branching-dashboard.sh "$image" "$dashboard_output"
