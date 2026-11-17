// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');

const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const layout = 'app/code/MageLens/Compatibility/view/frontend/layout';
for (const [handle, declaration, state, expected] of [
    ['coverageprobe_layout_arguments', '/page/body/referenceContainer/block/action[1]', 'covered', ['layout-action-executed']],
    ['coverageprobe_layout_arguments', '/page/body/referenceContainer/block/action[2]', 'uncovered', []],
    ['coverageprobe_layout_arguments_overlay', '/page/body/referenceBlock/action', 'covered', ['layout-action-executed']],
]) {
    const source = report.files.find(file => file.path === `${layout}/${handle}.xml`);
    assert.ok(source, `Missing action source ${handle}`);
    const item = source.declarations.find(item => item.node === declaration);
    assert.ok(item, `Missing action declaration ${declaration}`);
    assert.equal(item.state, state, declaration);
    assert.deepEqual([...new Set(item.evidence.map(entry => entry.type))], expected, declaration);
    assert.ok(item.evidence.every(entry => entry.area === 'frontend'), declaration);
}
console.log('Verified two attributable native action calls and zero hits for the guarded action.');
