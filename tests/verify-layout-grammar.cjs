// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const mode = process.argv[3] || 'developer';
assert.ok(['developer', 'production'].includes(mode));
for (const handle of ['const', 'serviceurl']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_grammar_${handle}.xml`));
    assert.ok(file, `Missing ${handle} fixture`);
    const argument = file.declarations.find(item => item.layout.instruction === 'argument' && item.layout.attribute === null);
    assert.equal(argument?.state, 'covered', handle);
    assert.deepEqual([...new Set(argument.evidence.map(event => event.type))].sort(),
        ['layout-argument-applied', 'layout-argument-evaluated', 'layout-argument-read']);
}
const failure = report.files.find(file => file.path.endsWith('/layout/coverageprobe_grammar_configurable.xml'));
const block = failure?.declarations.find(item => item.layout.kind === 'block');
assert.equal(block?.state, 'unmeasured');
assert.equal(block.hits, 0);
assert.deepEqual([...new Set(block.evidence.map(event => event.type))], ['layout-block-generation-failed']);
for (const variant of ['typeprefix', 'typelocalprefix']) {
    const source = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_grammar_${variant}.xml`));
    assert.ok(source, variant);
    const type = source.declarations.find(item => item.layout.attribute === 'typed:type');
    assert.equal(type.state, 'unmeasured');
    assert.equal(type.hits, 0);
    assert.deepEqual(type.evidence, []);
    assert.match(type.reason, /literal xsi prefix.*discarded before argument interpretation/);
    for (const declaration of source.declarations) {
        const groupRead = mode === 'production' && declaration.layout.kind === 'argument-group';
        assert.equal(declaration.hits, groupRead ? 2 : 0, variant);
        if (groupRead) assert.deepEqual([...new Set(declaration.evidence.map(event => event.type))], ['layout-argument-group-selected']);
    }
    const failed = source.declarations.find(item => item.layout.kind === 'block');
    assert.equal(failed.state, 'unmeasured');
    assert.deepEqual([...new Set(failed.evidence.map(event => event.type))],
        [mode === 'developer' ? 'layout-validation-failed' : 'layout-block-reading-failed']);
}
console.log('Verified inherited constant and service URL application and the configurable-object block generator failure.');
