// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const source = report.files.find(file => file.path.endsWith('/layout/coverageprobe_propertyownership_data_direct.xml'));
assert.ok(source, 'Missing direct-data fixture');
const arguments = source.declarations.filter(item => item.layout.kind === 'argument');
assert.equal(arguments.length, 3, 'Retain scalar, array parent and nested leaf');
for (const item of arguments) {
    const effects = [...new Set(item.evidence.map(event => event.type))].sort();
    assert.deepEqual(effects, ['layout-argument-applied', 'layout-argument-evaluated', 'layout-argument-field-access-unconfirmed'], item.node);
    assert.equal(item.state, 'covered', 'Keep proven earlier application');
    assert.match(item.reason, /outside the observed native data accessors/);
}
const template = source.declarations.find(item => item.layout.kind === 'template');
assert.ok(template.evidence.some(event => event.type === 'layout-template-executed'), 'Independent template execution');
const block = source.declarations.find(item => item.layout.kind === 'block');
assert.ok(block.evidence.some(event => event.type === 'layout-block-rendered'), 'Independent block rendering');
console.log('Verified direct PHP data writes retain earlier application while original value-read lineage remains unconfirmed.');
