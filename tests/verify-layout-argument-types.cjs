// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_layout_arguments.xml'));
assert.ok(file, 'Missing native typed-value fixture inventory');
const root = '/page/body/referenceContainer/block/arguments/argument';
for (let index = 1; index <= 25; index++) {
    const node = `${root}[${index}]/@xsi:type`;
    const item = file.declarations.find(item => item.node === node);
    assert.equal(item?.layout.kind, 'argument-type', node);
    assert.ok(item.evidence.some(event => event.type === 'layout-argument-type-evaluated'), node);
    assert.equal(item.state, 'covered', node);
    if ([6, 7, 8, 9, 11, 12].includes(index)) {
        assert.ok(item.evidence.some(event => event.type === 'layout-argument-type-deferred'), node);
    }
}
for (const handle of ['const', 'serviceurl', 'configurable']) {
    const source = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_grammar_${handle}.xml`));
    const type = source?.declarations.find(item => item.layout.kind === 'argument-type');
    assert.equal(type?.state, 'covered', handle);
    assert.deepEqual([...new Set(type.evidence.map(event => event.type))], ['layout-argument-type-evaluated'], handle);
}
const failure = report.files.find(file => file.path.endsWith('/layout/coverageprobe_grammar_configuredarray.xml'));
const failedType = failure?.declarations.find(item => item.layout.kind === 'argument-type');
assert.equal(failedType?.state, 'unmeasured');
assert.equal(failedType.hits, 0);
assert.deepEqual([...new Set(failedType.evidence.map(event => event.type))], ['layout-argument-type-failed']);
console.log('Verified original top-level type evaluation, deferred selection and native updater forwarding independently of value application.');
