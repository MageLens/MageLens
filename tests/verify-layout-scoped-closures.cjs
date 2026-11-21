// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_propertyownership_scoped.xml'));
assert.ok(file, 'Missing scoped field inventory');
const blocks = file.declarations.filter(item => item.layout.kind === 'block');
const templates = file.declarations.filter(item => item.layout.kind === 'template');
const arguments_ = file.declarations.filter(item => item.layout.kind === 'argument');
assert.equal(blocks.length, 6);
assert.equal(templates.length, 6);
assert.equal(arguments_.length, 12);
for (const item of blocks) {
    assert.equal(item.state, 'covered', item.node);
    assert.ok(item.evidence.some(event => event.type === 'layout-block-created'), item.node);
    assert.ok(item.evidence.some(event => event.type === 'layout-block-rendered'), item.node);
}
for (const item of templates) {
    assert.equal(item.state, 'unmeasured', item.node);
    assert.equal(item.hits, 0, item.node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(),
        ['layout-template-field-access-unconfirmed', 'layout-template-selected'], item.node);
}
for (const item of arguments_) {
    assert.equal(item.state, 'covered', item.node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(),
        ['layout-argument-applied', 'layout-argument-evaluated', 'layout-argument-field-access-unconfirmed'], item.node);
}
console.log('Verified scoped PHP writes retain original XML creation/application and explicit zero-hit consumption limits.');
