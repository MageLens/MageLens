// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const mode = process.argv[3] || 'developer';
assert.ok(['developer', 'production'].includes(mode));
for (const name of ['empty', 'missing', 'throw', 'after']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_renderfailure_${name}.xml`));
    assert.ok(file, name);
    const template = file.declarations.find(item => item.layout.kind === 'template');
    const types = [...new Set(template.evidence.map(event => event.type))].sort();
    assert.deepEqual(types, ['empty', 'after'].includes(name) ? ['layout-template-executed', 'layout-template-selected']
        : name === 'throw' ? ['layout-template-failed', 'layout-template-selected']
        : [...(mode === 'developer' ? ['layout-template-failed'] : []), 'layout-template-selected', 'layout-template-validation-rejected'], name);
    if (name === 'missing') assert.match(template.reason, /native template file validator rejected/);
    assert.equal(template.state, ['empty', 'after'].includes(name) ? 'covered' : 'unmeasured', name);
    assert.equal(template.hits > 0, ['empty', 'after'].includes(name), name);
    const block = file.declarations.find(item => item.layout.kind === 'block');
    assert.equal(block.evidence.some(event => event.type === 'layout-block-rendered'),
        name === 'empty' || (name === 'missing' && mode === 'production'), name);
    const failed = ['throw', 'after'].includes(name) || (name === 'missing' && mode === 'developer');
    assert.equal(block.evidence.some(event => event.type === 'layout-block-render-failed'), failed, name);
    assert.equal(block.state, failed ? 'unmeasured' : 'covered', name);
    assert.equal(block.hits > 0, !failed, name);
}
console.log(`Verified empty template execution, missing-file validation and throwing template boundaries in ${mode} mode.`);
