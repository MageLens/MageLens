// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {merge} = require(projectFile('bin/report-xml.cjs'));

const [directory] = process.argv.slice(2);
const results = new Map();
for (const mode of ['expect-cache-only', 'collect', 'collect-warm']) {
    const {files, sources, events, expected} = JSON.parse(fs.readFileSync(path.join(directory, mode + '-report.json')));
    const run = path.basename(directory);
    const report = merge({id: 'native-ui-proof', run, files}, [{
        manifest: 'native-ui-proof', run, request: mode, readHook: true, events
    }], Object.fromEntries(Object.entries(sources).map(([file, bytes]) => [file, Buffer.from(bytes)])));
    const declarations = new Map(report.files.flatMap(file => file.declarations.map(item => [item.id, item])));
    const actual = {};
    for (const [id, effects] of Object.entries(expected)) {
        actual[id] = Object.fromEntries(Object.keys(effects).map(effect => [effect, declarations.get(id).effectStates[effect]]));
    }
    assert.deepEqual(actual, expected, mode);
    if (mode === 'expect-cache-only') assert.equal(report.covered, 0);
    results.set(mode, actual);
}
assert.deepEqual(results.get('collect'), results.get('collect-warm'));
console.log('Verified native UI report effect states for cache-only, cold, and same-run warm collection.');
