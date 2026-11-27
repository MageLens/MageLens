// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
function field(handle, node, kind, state, types) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_layout_${handle}.xml`));
    const item = file?.declarations.find(item => item.node === node + '/@name');
    assert.ok(item, `${handle}/${node}`);
    assert.equal(item.layout.kind, kind);
    assert.equal(item.supported, true);
    assert.equal(item.state, state);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), types.sort());
    assert.equal(item.hits > 0, state === 'covered');
}
const argument = '/page/body/referenceContainer/block/arguments/argument';
for (const index of [1, 6, 10, 11, 12, 17, 18]) {
    field('arguments', `${argument}[${index}]`, 'argument-name', 'covered', ['layout-argument-name-applied']);
}
for (const node of [argument + '[5]', argument + '[5]/item[1]']) {
    field('arguments', node, 'argument-name', 'unmeasured', ['layout-argument-name-mixed-origin']);
}
field('arguments', argument + '[5]/item[1]/item[1]', 'argument-name', 'unmeasured', ['layout-argument-name-overridden']);
field('arguments', argument + '[5]/item[1]/item[2]', 'argument-name', 'covered', ['layout-argument-name-applied']);
field('arguments', argument + '[5]/item[2]', 'argument-name', 'unmeasured', ['layout-argument-name-overridden']);
field('arguments_overlay', '/page/body/referenceBlock/arguments/argument/item[2]', 'argument-name', 'covered', ['layout-argument-name-applied']);
for (const [handle, node, state, types] of [
    ['arguments', '/page/body/referenceContainer/block/action[1]/argument', 'covered', ['layout-action-argument-name-applied']],
    ['arguments', '/page/body/referenceContainer/block/action[2]/argument', 'uncovered', []],
    ['arguments', '/page/body/referenceContainer/block/action[3]/argument', 'covered', ['layout-action-argument-name-applied']],
    ['arguments_overlay', '/page/body/referenceBlock/action[2]/argument', 'unmeasured', ['layout-action-argument-name-ambiguous']],
]) field(handle, node, 'action-argument-name', state, types);
console.log('Verified original argument/item name operands, native assignment/call keys, mixed overlays and suppressed/ambiguous action operands.');
