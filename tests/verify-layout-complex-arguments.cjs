// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_layout_arguments.xml'));
for (const name of ['shared_first', 'shared_second', 'fresh_first', 'fresh_second', 'options', 'helper',
    'route', 'updatable', 'text_with_updater']) {
    const item = file?.declarations.find(item => item.layout.kind === 'argument' && item.layout.element === name);
    assert.equal(item?.state, 'covered', name);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(),
        ['layout-argument-applied', 'layout-argument-evaluated', 'layout-argument-read'], name);
}
for (const [handle, node] of [
    ['arguments', '/page/body/referenceContainer/block/arguments/argument[5]'],
    ['arguments', '/page/body/referenceContainer/block/arguments/argument[5]/item[1]'],
    ['arguments_overlay', '/page/body/referenceBlock/arguments/argument'],
    ['arguments_overlay', '/page/body/referenceBlock/arguments/argument/item[1]'],
]) {
    const source = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_layout_${handle}.xml`));
    const item = source?.declarations.find(item => item.node === node);
    assert.equal(item?.state, 'unmeasured', `${handle}/${node}`);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-argument-mixed-origin']);
}
for (const handle of ['constarray', 'configureddata', 'configuredvaluearray']) {
    const source = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_grammar_${handle}.xml`));
    for (const item of source?.declarations.filter(item => item.layout.kind === 'argument') || []) {
        assert.equal(item.state, 'covered', handle);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(),
            ['layout-argument-applied', 'layout-argument-evaluated', 'layout-argument-read'], handle);
    }
    assert.ok(source, handle);
}
const enumSource = report.files.find(file => file.path.endsWith('/layout/coverageprobe_grammar_constenum.xml'));
const enumTypes = enumSource?.declarations.filter(item => item.layout.kind === 'argument-type') || [];
assert.equal(enumTypes.length, 1);
assert.equal(enumTypes[0].hits, 1, 'Native constant interpretation completes before structure serialization fails');
assert.deepEqual([...new Set(enumTypes[0].evidence.map(event => event.type))], ['layout-argument-type-evaluated']);
for (const item of enumSource?.declarations || []) {
    if (item.layout.kind === 'argument-group') {
        assert.equal(item.hits, 2, 'Both native group reads complete before structure serialization fails');
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-argument-group-selected']);
    } else if (item.layout.kind !== 'argument-type') assert.equal(item.hits, 0, 'Native structure serialization fails before generation');
}
assert.ok(enumSource);
const failure = report.files.find(file => file.path.endsWith('/layout/coverageprobe_grammar_configuredarray.xml'));
const failedBlock = failure?.declarations.find(item => item.layout.kind === 'block');
assert.equal(failedBlock?.state, 'unmeasured');
assert.deepEqual([...new Set(failedBlock.evidence.map(event => event.type))], ['layout-block-reading-failed']);
console.log('Verified native value evaluation, object identities, complex application/read boundaries, mixed parents and native reader failure.');
