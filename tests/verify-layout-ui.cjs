// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(file => file.path === 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_component_index.xml');
assert.ok(file, 'Missing layout UI placement file');
const placement = file.declarations.find(item => item.layout?.instruction === 'uiComponent' && item.layout.attribute === null);
assert.equal(placement?.state, 'covered');
assert.deepEqual([...new Set(placement.evidence.map(event => event.type))].sort(), ['layout-ui-created', 'layout-ui-rendered']);
for (const attribute of ['component']) {
    const item = file.declarations.find(item => item.layout?.instruction === 'uiComponent' && item.layout.attribute === attribute);
    assert.equal(item?.state, 'unmeasured');
    assert.equal(item.hits, 0);
}
const argument = file.declarations.find(item => item.layout?.instruction === 'argument' && item.layout.attribute === null);
assert.equal(argument?.state, 'unmeasured');
assert.equal(argument.hits, 0);
assert.ok(!report.files.some(file => file.family === 'layout' && file.path.includes('/ui_component/')));
console.log('Verified layout UI creation and rendering, ignored placement values, and the standalone configuration boundary.');
