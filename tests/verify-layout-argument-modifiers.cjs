// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_layout_arguments.xml'));
assert.ok(file, 'Missing native modifier fixture');
const fields = file.declarations.filter(item => ['translate', 'shared', 'model', 'helper', 'path'].includes(item.layout.attribute));
assert.equal(fields.length, 9, 'Original modifier inventory');
for (const item of fields) {
    assert.equal(item.layout.kind, `argument-${item.layout.attribute}`, item.node);
    assert.equal(item.state, 'covered', item.node);
    const effects = ['layout-argument-modifier-evaluated'];
    if (['shared', 'helper', 'path'].includes(item.layout.attribute)) effects.push('layout-argument-modifier-deferred');
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), effects.sort(), item.node);
}
for (const handle of ['updaterorder', 'updaterenabled']) {
    const source = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_grammar_${handle}.xml`));
    const field = source?.declarations.find(item => item.layout.kind === 'argument-model');
    assert.equal(field?.state, 'covered', handle);
    assert.deepEqual([...new Set(field.evidence.map(event => event.type))], ['layout-argument-modifier-evaluated'], handle);
}
const service = report.files.find(file => file.path.endsWith('/layout/coverageprobe_grammar_serviceurl.xml'));
const servicePath = service?.declarations.find(item => item.layout.kind === 'argument-path');
assert.equal(servicePath?.state, 'covered', 'Native service URL path');
assert.deepEqual([...new Set(servicePath.evidence.map(event => event.type))], ['layout-argument-modifier-evaluated']);
const unvisited = report.files.find(file => file.path.endsWith('/layout/coverageprobe_interpreter_index.xml'));
const unvisitedFields = unvisited?.declarations.filter(item => item.layout.kind === 'argument-helper');
assert.equal(unvisitedFields?.length, 3, 'Complete unvisited block/item/action modifier inventory');
assert.equal(unvisitedFields.filter(item => item.node.includes('/action/')).length, 1, 'Retain the unvisited action helper field');
for (const item of unvisitedFields) {
    assert.equal(item.state, 'uncovered', item.node);
    assert.equal(item.hits, 0, item.node);
    assert.deepEqual(item.evidence, [], item.node);
}
console.log('Verified independent native sharing, translation, model, helper and URL-path operand evaluation and zero-hit unvisited fields.');
