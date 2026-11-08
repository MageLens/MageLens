#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
cd "$(dirname "$0")/../.."
[[ $# == 1 ]] || { echo 'Usage: tests/ci/cypress-image.sh IMAGE' >&2; exit 1; }
image=$1
source bin/dependencies
load_dependencies dependencies.yaml
expected=$(node -p 'require("./branching/images.cjs").describe(process.cwd(), "cypress").fingerprint')
actual=$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.magelens.inputs"}}' "$image")
[[ "$actual" == "linux/amd64 $expected" ]] || { echo 'Unexpected Cypress adapter image provenance.' >&2; exit 1; }
docker run --rm --network none --entrypoint sh "$image" -c \
    'command -v docker && docker compose version && ! command -v magelens-plan && ! command -v cargo && ! command -v rustc'
docker run --rm --network none --entrypoint node "$image" -e \
    'require("node:assert/strict").throws(() => require.resolve("@playwright/test"), {code:"MODULE_NOT_FOUND"});'
# Mount only framework source: retain the image's own pinned npm dependencies.
docker run --rm --init --network none --memory 4g --memory-swap 4g --cpus 2 --shm-size 1g \
    --mount "type=bind,source=$PWD/branching,target=/workspace/branching,readonly" \
    --mount "type=bind,source=$PWD/bin,target=/workspace/bin,readonly" \
    --mount "type=bind,source=$PWD/docker,target=/workspace/docker,readonly" \
    --mount "type=bind,source=$PWD/tests,target=/workspace/tests,readonly" \
    --env CYPRESS_VERSION --env CHROME_VERSION --workdir /workspace \
    "$image" tests/branching-cypress-browser.cjs
