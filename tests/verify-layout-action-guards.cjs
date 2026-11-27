// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
function check(handle, node, state, types) {
    const file = report.files.find(file => file.path === `app/code/MageLens/Compatibility/view/frontend/layout/${handle}.xml`);
    const item = file?.declarations.find(item => item.node === node + '/@ifconfig');
    assert.ok(item, `${handle}/${node}`);
    assert.equal(item.layout.kind, 'action-ifconfig', node);
    assert.equal(item.state, state, node);
    assert.equal(item.hits > 0, state === 'covered', node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), types.sort(), node);
    assert.ok(item.evidence.every(event => event.area === 'frontend'), node);
}
for (const [node, effect] of [
    ['block[1]/action', 'allowed'], ['block[2]/action', 'denied'],
    ['block[3]/action[1]', 'ambiguous'], ['block[3]/action[2]', 'ambiguous'],
    ['block[4]/action', 'empty-ignored'], ['block[5]/action', 'empty-ignored'],
    ['block[6]/action[1]', 'allowed'], ['block[6]/action[2]', 'denied'],
]) check('coverageprobe_actionguards', '/layout/container/' + node,
    ['allowed', 'denied'].includes(effect) ? 'covered' : 'unmeasured', ['layout-action-condition-' + effect]);
check('coverageprobe_actionguards', '/layout/referenceBlock/action', 'uncovered', []);
check('coverageprobe_actionguards_never', '/layout/block/action', 'uncovered', []);
check('coverageprobe_layout_arguments', '/page/body/referenceContainer/block/action[2]', 'unmeasured', ['layout-action-condition-ambiguous']);
check('coverageprobe_layout_arguments_overlay', '/page/body/referenceBlock/action[2]', 'unmeasured', ['layout-action-condition-ambiguous']);
console.log('Verified independent native action guard decisions, ambiguity, short circuits and unvisited operands.');
