#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -ne 1 || "$1" == --help ]]; then
    printf 'Usage: bash tests/branching-dashboard.sh PLAYWRIGHT_ADAPTER_IMAGE\nRust instrumentation runs in a separate container.\n'
    [[ ${1:-} == --help ]] && exit 0 || exit 1
fi
root=$(pwd -P)
output="$root/.runtime/branching-dashboard-self-test/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$output/workspace"
rust_image=$(docker build --quiet --file tests/branching-rust-coverage.Dockerfile .)
controller=$(docker run --detach --rm --init --network none --memory 1g --memory-swap 1g --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$root,target=/driver,readonly" \
    --mount "type=bind,source=$output,target=/artifacts" \
    --mount "type=bind,source=$output/workspace,target=/shared" \
    --entrypoint sleep "$rust_image" infinity)
trap 'docker rm --force "$controller" >/dev/null' EXIT
printf 'Dashboard self-tests and self-coverage: %s\n' "$output"
docker run --rm --init --network none --memory 2g --memory-swap 2g --shm-size 512m \
    --user "$(id -u):$(id -g)" --group-add "$(stat -c '%g' /var/run/docker.sock)" --env HOME=/tmp --env TMPDIR=/shared \
    --env NODE_PATH=/workspace/node_modules --env MAGELENS_RUST_SELF_COVERAGE=1 \
    --env "MAGELENS_ORCHESTRATOR_CONTAINER=$controller" \
    --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
    --mount "type=bind,source=$root,target=/driver,readonly" \
    --mount "type=bind,source=$output,target=/artifacts" \
    --mount "type=bind,source=$output/workspace,target=/shared" --workdir /driver \
    --entrypoint node "$1" tests/branching-dashboard-browser.cjs /artifacts
