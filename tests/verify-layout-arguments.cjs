// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');

const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const layout = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_layout_arguments.xml';
const source = report.files.find(file => file.path === layout);
assert.ok(source, 'Missing typed arguments source');

const path = '/page/body/referenceContainer/block/arguments/argument';
for (const [index, name] of [[1, 'literal'], [2, 'amount'], [3, 'flag'], [4, 'nullable'],
    [15, 'translated'], [16, 'untranslated'], [17, 'unread'], [18, 'replaced']]) {
    const item = source.declarations.find(item => item.node === `${path}[${index}]`);
    assert.equal(item?.layout.element, name);
    assert.equal(item.state, 'covered', name);
    assert.deepEqual([...new Set(item.evidence.map(entry => entry.type))], ['layout-argument-applied'], name);
}
for (const [index, name] of [[5, 'matrix'], [6, 'shared_first'], [10, 'options'], [11, 'helper'],
    [12, 'route'], [13, 'updatable'], [14, 'text_with_updater']]) {
    const item = source.declarations.find(item => item.node === `${path}[${index}]`);
    assert.equal(item?.layout.element, name);
    assert.equal(item.state, 'unmeasured', name);
    assert.equal(item.hits, 0, name);
}
console.log('Verified scalar layout values reached native block data assignments, including unread and later replaced values.');
