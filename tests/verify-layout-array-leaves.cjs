// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const directory = 'app/code/MageLens/Compatibility/view/frontend/layout';
for (const [handle, path, state] of [
    ['arguments', '/page/body/referenceContainer/block/arguments/argument[5]/item[1]/item[1]', 'unmeasured'],
    ['arguments', '/page/body/referenceContainer/block/arguments/argument[5]/item[1]/item[2]', 'covered'],
    ['arguments', '/page/body/referenceContainer/block/arguments/argument[5]/item[2]', 'unmeasured'],
    ['arguments_overlay', '/page/body/referenceBlock/arguments/argument/item[1]/item', 'covered'],
    ['arguments_overlay', '/page/body/referenceBlock/arguments/argument/item[2]', 'covered'],
]) {
    const file = report.files.find(item => item.path === `${directory}/coverageprobe_layout_${handle}.xml`);
    const item = file?.declarations.find(item => item.node === path);
    assert.ok(item, `Missing leaf ${handle}/${path}`);
    assert.equal(item.state, state, `${handle}/${path}`);
    const effects = state === 'covered' ? ['layout-argument-applied', 'layout-argument-evaluated'] : ['layout-argument-overridden'];
    if (handle === 'arguments' && path.endsWith('/item[1]/item[2]')) effects.push('layout-argument-read');
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), effects.sort());
}
console.log('Verified independently attributed array leaves, surviving children and an equal-valued overlay.');
