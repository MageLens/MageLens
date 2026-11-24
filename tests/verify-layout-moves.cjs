// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');

const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const source = report.files.find(file =>
    file.path === 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_layout_structure.xml');
assert.ok(source, 'Missing layout structure fixture');
for (const [element, state, effect] of [
    ['magelens.layout.moved', 'covered', 'layout-move-applied'],
    ['magelens.layout.absent', 'unmeasured', 'layout-move-target-missing'],
    ['magelens.layout.moved-removed', 'covered', 'layout-move-removed']
]) {
    const matches = source.declarations.filter(item => item.layout?.kind === 'move' && item.layout.element === element);
    assert.equal(matches.length, 1, `Missing move origin for ${element}`);
    const [item] = matches;
    assert.equal(item.state, state);
    assert.deepEqual([...new Set(item.evidence.map(entry => entry.type))], [effect]);
    assert.ok(item.evidence.every(entry => entry.area === 'frontend'));
}
console.log('Verified applied, missing-target and removed-subtree move outcomes at their original declarations.');
