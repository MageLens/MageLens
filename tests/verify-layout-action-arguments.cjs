// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const [handle, node, state, effects] of [
    ['arguments', '/page/body/referenceContainer/block/action[1]/argument', 'covered', ['layout-action-argument-applied']],
    ['arguments', '/page/body/referenceContainer/block/action[2]/argument', 'uncovered', []],
    ['arguments', '/page/body/referenceContainer/block/action[3]/argument', 'covered', ['layout-action-argument-applied']],
    ['arguments_overlay', '/page/body/referenceBlock/action[1]/argument', 'covered', ['layout-action-argument-applied']],
    ['arguments_overlay', '/page/body/referenceBlock/action[2]/argument', 'unmeasured', ['layout-action-argument-ambiguous']],
    ['arguments_overlay', '/page/body/referenceBlock/action[3]/argument', 'unmeasured', ['layout-action-argument-ambiguous']],
]) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_layout_${handle}.xml`));
    const item = file?.declarations.find(item => item.node === node);
    assert.ok(item, `Missing original action argument ${handle}/${node}`);
    assert.equal(item.state, state, `${handle}/${node}`);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], effects);
}
console.log('Verified native scalar and configurable-object parameter application, suppressed evaluation and ambiguous origins.');
