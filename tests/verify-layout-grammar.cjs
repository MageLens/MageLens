// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
for (const handle of ['const', 'serviceurl']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_grammar_${handle}.xml`));
    assert.ok(file, `Missing ${handle} fixture`);
    const argument = file.declarations.find(item => item.layout.instruction === 'argument' && item.layout.attribute === null);
    assert.equal(argument?.state, 'covered', handle);
    assert.deepEqual([...new Set(argument.evidence.map(event => event.type))].sort(),
        ['layout-argument-applied', 'layout-argument-evaluated', 'layout-argument-read']);
}
const failure = report.files.find(file => file.path.endsWith('/layout/coverageprobe_grammar_configurable.xml'));
const block = failure?.declarations.find(item => item.layout.kind === 'block');
assert.equal(block?.state, 'unmeasured');
assert.equal(block.hits, 0);
assert.deepEqual([...new Set(block.evidence.map(event => event.type))], ['layout-block-generation-failed']);
console.log('Verified inherited constant and service URL application and the configurable-object block generator failure.');
