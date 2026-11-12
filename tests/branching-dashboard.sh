#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -lt 1 || $# -gt 2 || "$1" == --help ]]; then
    printf 'Usage: bash tests/branching-dashboard.sh PLAYWRIGHT_ADAPTER_IMAGE [OUTPUT_DIRECTORY]\nRust instrumentation runs in a separate container.\n'
    [[ ${1:-} == --help ]] && exit 0 || exit 1
fi
root=$(pwd -P)
output=${2:-"$root/.runtime/branching-dashboard-self-test/$(date -u +%Y%m%dT%H%M%SZ)-$$"}
[[ ! -e "$output" ]] || { echo 'Dashboard output must be fresh.' >&2; exit 1; }
output=$(realpath -m "$output")
mkdir -p "$output/workspace"
orchestrator=$(./bin/branching-image orchestrator --build-from-source)
rust_image=$(docker build --quiet --build-arg "ORCHESTRATOR_IMAGE=$orchestrator" --file tests/branching-rust-coverage.Dockerfile .)
# Fixed forecasts isolate dashboard/engine behavior from model accuracy.
docker run --rm --network none --env NODE_PATH=/opt/magelens/node_modules \
    --mount "type=bind,source=$root,target=/driver,readonly" --entrypoint node "$orchestrator" \
    -e 'process.stdout.write(JSON.stringify(require("/driver/tests/fixtures/branching/predictor.cjs").model(100)))' > "$output/model.json"
model_digest=$(sha256sum "$output/model.json" | cut -d ' ' -f 1)
controller=$(docker run --detach --rm --init --network none --memory 1g --memory-swap 1g --user "$(id -u):$(id -g)" \
    --env MAGELENS_PREDICTOR_MODEL=/artifacts/model.json --env "MAGELENS_PREDICTOR_MODEL_SHA256=$model_digest" \
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
