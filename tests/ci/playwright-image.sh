#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
cd "$(dirname "$0")/../.."
[[ $# == 1 ]] || { echo 'Usage: tests/ci/playwright-image.sh IMAGE' >&2; exit 1; }
image=$1
source bin/dependencies
load_dependencies dependencies.yaml
expected=$(node -p 'require("./branching/images.cjs").describe(process.cwd(), "playwright").fingerprint')
actual=$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.magelens.inputs"}}' "$image")
[[ "$actual" == "linux/amd64 $expected" ]] || { echo 'Unexpected Playwright adapter image provenance.' >&2; exit 1; }
docker run --rm --network none --entrypoint sh "$image" -c \
    'command -v docker && docker compose version && ! command -v magelens-plan && ! command -v cargo && ! command -v rustc'
docker run --rm --init --network none --memory 1g --memory-swap 1g --shm-size 256m \
    --env PLAYWRIGHT_VERSION --env CHROME_VERSION --entrypoint node "$image" -e '
const assert = require("node:assert/strict");
assert.equal(require("@playwright/test/package.json").version, process.env.PLAYWRIGHT_VERSION);
assert.throws(() => require.resolve("cypress"), {code: "MODULE_NOT_FOUND"});
(async () => {
    const browser = await require("@playwright/test").chromium.launch({channel: "chrome", headless: true});
    try { assert.equal(browser.version(), process.env.CHROME_VERSION); console.log("Pinned Playwright and Chrome verified."); }
    finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});'
