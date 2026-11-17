// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_layout_arguments.xml'));
for (const [name, effects] of [
    ...['literal', 'amount', 'flag', 'nullable', 'translated', 'untranslated', 'offset_read']
        .map(name => [name, ['layout-argument-applied', 'layout-argument-read']]),
    ['unread', ['layout-argument-applied']],
    ...['replaced', 'equal_replaced', 'unset_nullable', 'offset_replaced']
        .map(name => [name, ['layout-argument-applied', 'layout-argument-replaced']]),
]) {
    const item = file?.declarations.find(item => item.layout.kind === 'argument' && item.layout.element === name);
    assert.equal(item?.state, 'covered', name);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), effects.sort(), name);
}
const leaf = file.declarations.find(item => item.node === '/page/body/referenceContainer/block/arguments/argument[5]/item[1]/item[2]');
assert.deepEqual([...new Set(leaf.evidence.map(event => event.type))].sort(), ['layout-argument-applied', 'layout-argument-read']);
console.log('Verified explicit getter and array-access reads, nested path reads, unread values and revoked equal/null/offset replacements.');
