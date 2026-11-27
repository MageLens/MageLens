// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const [name, types] of [
    ['failed', ['layout-template-failed', 'layout-template-selected']],
    ['success', ['layout-template-executed', 'layout-template-selected']],
]) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_boundary_${name}.xml`));
    assert.ok(file, name);
    const block = file.declarations.find(item => item.layout.kind === 'block');
    assert.equal(block?.layout.element, 'magelens.layout.boundary.same');
    assert.equal(block.state, name === 'success' ? 'covered' : 'unmeasured');
    assert.equal(block.evidence.some(event => event.type === 'layout-block-render-failed'), name === 'failed');
    assert.equal(block.evidence.some(event => event.type === 'layout-block-rendered'), name === 'success');
    const template = file.declarations.find(item => item.layout.kind === 'template');
    assert.deepEqual([...new Set(template?.evidence.map(event => event.type))].sort(), types, name);
    assert.equal(template.evidence.some(event => event.type === 'layout-template-executed'), name === 'success');
    const value = file.declarations.find(item => item.layout.kind === 'argument');
    assert.deepEqual([...new Set(value?.evidence.map(event => event.type))].sort(),
        ['layout-argument-applied', 'layout-argument-evaluated', 'layout-argument-read']);
}
console.log('Verified independent origins across two layout instances sharing a block name, including a failed template boundary.');
