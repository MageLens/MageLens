// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const handle of ['coverageprobe_index_index', 'coverageprobe_layout_nested', 'coverageprobe_layout_dynamic', 'coverageprobe_fragment_index']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/${handle}.xml`));
    const root = file?.declarations.find(item => item.node === (handle === 'coverageprobe_fragment_index' ? '/layout' : '/page'));
    assert.equal(root?.state, 'unmeasured', handle);
    assert.equal(root.hits, 0, handle);
    assert.ok(root.evidence.some(event => event.type === 'layout-file-selected'), handle);
}
const unvisited = report.files.find(file => file.path.endsWith('/layout/coverageprobe_layout_unvisited.xml'));
assert.equal(unvisited?.declarations.find(item => item.node === '/page')?.hits, 0);
assert.ok(!unvisited.declarations.find(item => item.node === '/page').evidence.length);
const defaults = report.files.filter(file => file.path.endsWith('/Magento_Theme/layout/default.xml'));
for (const file of defaults) {
    assert.ok(file.declarations.some(item => item.layout.kind === 'file-selection'
        && item.evidence.some(event => event.type === 'layout-file-selected')));
}
const source = report.files.find(file => file.path.endsWith('/layout/coverageprobe_handle_index.xml'));
for (const item of source.declarations.filter(item => item.layout.kind === 'include')) {
    const attribute = source.declarations.find(attribute => attribute.node === item.node + '/@handle');
    assert.equal(attribute?.state, item.state);
    assert.deepEqual([...new Set(attribute.evidence.map(event => event.type))].sort(),
        [...new Set(item.evidence.map(event => event.type))].sort());
}
console.log('Verified zero-hit original file selections for default, action, included, dynamic and generic handles, unvisited files and include handle attributes.');
