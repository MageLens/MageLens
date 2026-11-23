// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_layout_arguments.xml'));
for (const [argument, state, type] of [
    [13, 'covered', 'layout-updater-executed'],
    [14, 'unmeasured', 'layout-updater-ignored'],
]) {
    const item = file?.declarations.find(item => item.node === `/page/body/referenceContainer/block/arguments/argument[${argument}]/updater`);
    assert.equal(item?.state, state, `updater ${argument}`);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], [type]);
}
for (const name of ['updaterenabled', 'updaterorder']) {
    const source = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_grammar_${name}.xml`));
    const item = source?.declarations.find(item => item.layout.kind === 'argument-updater');
    assert.equal(item?.state, 'unmeasured', name);
    assert.equal(item.hits, 0);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-updater-failed']);
}
console.log('Verified native updater execution, parser omission, and native class lookup failures.');
