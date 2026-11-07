#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
cd "$(dirname "$0")/../.."
[[ $# == 1 ]] || { echo 'Usage: tests/ci/orchestrator-image.sh IMAGE' >&2; exit 1; }
image=$1
root=$(pwd -P)
output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT
expected=$(node -p 'require("./branching/images.cjs").describe(process.cwd(), "orchestrator").fingerprint')
actual=$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.magelens.inputs"}}' "$image")
[[ "$actual" == "linux/amd64 $expected" ]] || { echo 'Unexpected orchestrator image provenance.' >&2; exit 1; }
for operation in plan verify; do
    arguments=(verify /output/manifest.json)
    [[ "$operation" != plan ]] || arguments=(plan /source /output/manifest.json)
    docker run --rm --init --network none --memory 512m --memory-swap 512m --user "$(id -u):$(id -g)" \
        --mount "type=bind,source=$root/tests/fixtures/branching-source,target=/source,readonly" \
        --mount "type=bind,source=$output,target=/output" "$image" "${arguments[@]}"
done
node tests/branching-plan-smoke.cjs "$output/manifest.json"
docker run --rm --network none --entrypoint sh "$image" -c \
    'test -x /usr/local/bin/magelens-plan && ! command -v cargo && ! command -v node && ! command -v google-chrome-stable'
