// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const name of ['cold', 'warm']) {
    const file = report.files.find(item => item.path.endsWith(`/layout/coverageprobe_cache_${name}.xml`));
    assert.ok(file, name);
    const template = file.declarations.find(item => item.layout.kind === 'template');
    assert.deepEqual([...new Set(template.evidence.map(event => event.type))].sort(), name === 'cold'
        ? ['layout-template-executed', 'layout-template-selected']
        : ['layout-template-cache-unconfirmed', 'layout-template-selected'], name);
    assert.equal(template.state, name === 'cold' ? 'covered' : 'unmeasured', name);
    assert.equal(template.hits > 0, name === 'cold', name);
    const value = file.declarations.find(item => item.layout.kind === 'argument' && item.layout.element === 'value');
    assert.ok(value.evidence.some(event => event.type === 'layout-argument-applied'), name);
    assert.equal(value.evidence.some(event => event.type === 'layout-argument-read'), name === 'cold', name);
    const block = file.declarations.find(item => item.layout.kind === 'block');
    assert.ok(block.evidence.some(event => event.type === 'layout-block-created'), name);
}
console.log('Verified fresh XML construction and supplied values across a cold render and warm block HTML cache bypass.');
