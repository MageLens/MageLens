// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const source = report.files.find(file => file.path.endsWith('/layout/coverageprobe_layout_base.xml'));
for (const [kind, fact, boundary] of [
    ['block', 'layout-block-created', 'layout-block-rendered'],
    ['template', 'layout-template-selected', 'layout-template-executed'],
]) {
    const item = source.declarations.find(item => item.layout.element === 'magelens.layout.unrendered' && item.layout.kind === kind);
    assert.ok(item, kind);
    assert.ok(item.evidence.some(event => event.type === fact), kind + ': keep the construction/selection fact');
    assert.equal(item.evidence.some(event => event.type === boundary), false, kind + ': native rendering never occurred');
    assert.equal(item.state, 'uncovered', kind + ': unrendered declarations must remain uncovered');
    assert.equal(item.hits, 0, kind + ': observations cannot become rendering hits');
}
const late = source.declarations.find(item => item.layout.element === 'magelens.layout.late' && item.layout.kind === 'template');
assert.deepEqual(late.evidence.map(event => event.type).sort(), ['layout-template-replaced', 'layout-template-selected']);
assert.equal(late.state, 'unmeasured');
assert.equal(late.hits, 0);
console.log('Verified creation and selection facts cannot substitute for native block/template rendering.');
