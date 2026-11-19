// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {merge} = require('../bin/report-xml.cjs');
const [mode, input, sourceRoot = 'src'] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(input));
const manifest = {id: 'layout-cache-proof', run: 'layout-cache-proof', files: data.files, layoutSources: data.layoutSources};
const sources = Object.fromEntries(data.files.map(file => [file.path, fs.readFileSync(path.join(sourceRoot, file.path))]));
const {files, layoutSources, ...evidence} = data;
const report = merge(manifest, [{...evidence, manifest: manifest.id, run: manifest.run, request: 'layout-cache-proof', readHook: true}], sources);
assert.equal(report.files.length, 1, 'Retain complete original fixture inventory');
assert.equal(report.files[0].declarations.length, data.files[0].declarations.length);
const target = report.files[0].declarations.filter(item => ['block', 'template', 'argument'].includes(item.layout.kind));
assert.equal(target.length, 4);
for (const item of target) {
    if (mode === 'cold') assert.equal(item.state, 'covered', item.node);
    else assert.equal(item.hits, 0, item.node);
}
if (mode !== 'cold') assert.ok(report.layout.limitations.length, 'Cache bypass lacks an explicit report limitation');
assert.throws(() => merge({...manifest, run: 'stale'}, [{...evidence, manifest: manifest.id, run: manifest.run, request: 'layout-cache-proof', readHook: true}], sources), /Stale XML request/);
console.log(`Verified native ${mode} cache evidence through report validation and complete zero-hit inventory.`);
