// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const directory = 'app/code/MageLens/Compatibility/view/frontend/layout';
for (const [handle, name, kind, effect] of [
    ['head', 'magelens-replaced', 'metadata', 'layout-metadata-replaced'],
    ['head', 'data-layout-replaced', 'page-attribute', 'layout-page-attribute-replaced'],
    ['structure', 'magelens.layout.right', 'container-htmlId', 'layout-container-attribute-replaced'],
]) {
    const file = report.files.find(file => file.path === `${directory}/coverageprobe_layout_${handle}.xml`);
    const item = file?.declarations.find(item => item.layout?.element === name && item.layout.kind === kind);
    assert.ok(item, `Missing replacement origin ${name}`);
    assert.equal(item.state, 'unmeasured', name);
    assert.equal(item.hits, 0, name);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], [effect], name);
}
console.log('Verified equal-valued runtime replacements revoke XML output attribution for metadata, page and container attributes.');
