#!/usr/bin/env bash
# SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
# SPDX-License-Identifier: Elastic-2.0
# License: see LICENSE in the repository root.

set -euo pipefail
# This is a source rebuild, including Cypress's own packaging/integrity checks.
# Never edit the official compiled binary or change application cookie handling.
source_commit=519d66d80b0ae1bd3f9581665ce69473b82af59b
version=16.2.1
[[ "$(node --version)" == v24.15.0 && "$(yarn --version)" == 1.22.22 ]]
[[ "$(node -p 'require("/input/package.json").devDependencies.cypress')" == "$version" ]] || {
    echo 'Review or remove the Cypress source fix before changing its version.' >&2
    exit 1
}
mkdir -p /build/source /build/tmp /output
cd /build/source
git init --quiet
git remote add origin https://github.com/cypress-io/cypress.git
git fetch --depth=1 origin "$source_commit"
git checkout --quiet --detach FETCH_HEAD
[[ "$(git rev-parse HEAD)" == "$source_commit" ]]
git apply --check /input/primary-cookie.patch
git apply /input/primary-cookie.patch
[[ "$(node --version)" == "v$(cat .node-version)" ]]
yarn install --frozen-lockfile --network-concurrency 4
# Set the release version before prebuilding with bounded concurrency. keepBuild
# then stages these exact outputs, without another unbounded package build.
node -e 'const fs=require("fs"); const p=require("./package.json"); p.version=process.argv[1]; fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")' "$version"
yarn lerna run build --stream --concurrency 2
yarn lerna run build-prod --stream --concurrency 2
env -u ELECTRON_RUN_AS_NODE node scripts/binary.js build --version "$version" --platform linux --keepBuild
xvfb-run -a env -u ELECTRON_RUN_AS_NODE node scripts/binary.js package --version "$version" --platform linux
case "$(node -p process.arch)" in
    x64) packaged=/build/tmp/cypress-build/linux/build/linux-unpacked ;;
    arm64) packaged=/build/tmp/cypress-build/linux/build/linux-arm64-unpacked ;;
    *) echo 'Unsupported Cypress source-build architecture.' >&2; exit 1 ;;
esac
[[ "$(xvfb-run -a "$packaged/Cypress" --no-sandbox --version)" == "$version" ]]
mv "$packaged" /output/Cypress
cp LICENSE /output/Cypress/LICENSE.cypress
node - "$source_commit" "$version" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
fs.writeFileSync('/output/Cypress/magelens-build.json', JSON.stringify({
    distribution: 'MageLens source build', version: process.argv[3],
    repository: 'https://github.com/cypress-io/cypress', commit: process.argv[2],
    patchSha256: crypto.createHash('sha256').update(fs.readFileSync('/input/primary-cookie.patch')).digest('hex'),
    architecture: process.arch, buildNode: process.version
}, null, 2) + '\n');
NODE
