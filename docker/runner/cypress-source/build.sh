#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
# This is a source rebuild, including Cypress's own packaging/integrity checks.
# Never edit the official compiled binary or change application cookie handling.
source_commit=$(node /input/provenance.cjs commit)
version=$(node /input/provenance.cjs version)
[[ "$(node --version)" == "$(node /input/provenance.cjs buildNode)" && "$(yarn --version)" == 1.22.22 ]]
[[ "$(node -p 'require("/input/package.json").devDependencies.cypress')" == "$version" ]] || {
    echo 'Review or remove the Cypress source fixes before changing its version.' >&2
    exit 1
}
mkdir -p /build/source /build/tmp /output
cd /build/source
git init --quiet
git remote add origin https://github.com/cypress-io/cypress.git
git fetch --depth=1 origin "$source_commit"
git checkout --quiet --detach FETCH_HEAD
[[ "$(git rev-parse HEAD)" == "$source_commit" ]]
git apply --check /input/runner-fixes.patch
git apply /input/runner-fixes.patch
[[ "$(node --version)" == "v$(cat .node-version)" ]]
yarn install --frozen-lockfile --network-concurrency 4
# Match Yarn's script PATH when invoking the packager directly to retain the
# smaller heap limit. Staged production postinstall scripts use these build tools.
export PATH="$PWD/node_modules/.bin:$PATH"
# The Docker stage restricts CPU affinity to two CPUs. Cypress's standard binary
# builder derives its worker count from that affinity, including build-prod.
node -e 'const fs=require("fs"); const p=require("./package.json"); p.version=process.argv[1]; fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")' "$version"
yarn lerna run build --stream --concurrency 2
yarn workspace @packages/network-interception test run --maxWorkers=2 --minWorkers=1
yarn workspace @packages/proxy test --maxWorkers=2 --minWorkers=1
yarn workspace @packages/server test-unit test/unit/browsers/cdp_automation.spec.ts test/unit/browsers/cdp-fetch-transport.spec.ts test/unit/network-runtime.spec.ts --maxWorkers=2 --minWorkers=1
yarn workspace @packages/proxy check-ts
yarn workspace @packages/network-interception check-ts
yarn workspace @packages/server check-ts
env -u ELECTRON_RUN_AS_NODE node scripts/binary.js build --version "$version" --platform linux
# Fetch the exact Electron release and snapshot tools before packaging. Keep
# download recovery separate from compilation, tests and snapshot generation.
node /input/prepare-electron.cjs "$PWD"
xvfb-run -a env -u ELECTRON_RUN_AS_NODE node scripts/binary.js package --version "$version" --platform linux
case "$(node -p process.arch)" in
    x64) packaged=/build/tmp/cypress-build/linux/build/linux-unpacked ;;
    arm64) packaged=/build/tmp/cypress-build/linux/build/linux-arm64-unpacked ;;
    *) echo 'Unsupported Cypress source-build architecture.' >&2; exit 1 ;;
esac
[[ "$(xvfb-run -a "$packaged/Cypress" --no-sandbox --version)" == "$version" ]]
mkdir -p "/output/$version"
mv "$packaged" "/output/$version/Cypress"
cp LICENSE "/output/$version/Cypress/LICENSE.cypress"
node /input/provenance.cjs > "/output/$version/Cypress/magelens-build.json"
# Dependencies and intermediate trees are build inputs, not image/cache payloads.
cd /output
rm -rf /build/source /build/tmp /root/.cache /usr/local/share/.cache/yarn
