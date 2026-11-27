// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const source = report.files.find(file => file.path === 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_page_metadata.xml');
assert.ok(source, 'Missing specialized metadata source');

function verify(node, effects, covered = true) {
    const item = source.declarations.find(item => item.node === node);
    assert.ok(item, `Missing original declaration ${node}`);
    assert.equal(item.state, covered ? 'covered' : 'unmeasured', node);
    assert.equal(item.hits > 0, covered, node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), effects, node);
}

for (const suffix of ['', '/@name', '/@content']) {
    verify('/page/head/meta[1]' + suffix, ['layout-metadata-content-type-input', 'layout-metadata-rendered']);
    verify('/page/head/meta[2]' + suffix, ['layout-metadata-content-type-derived']);
    verify('/page/head/meta[3]' + suffix, ['layout-metadata-content-type-input', 'layout-metadata-template-skipped']);
    for (const index of [4, 6, 7]) verify(`/page/head/meta[${index}]${suffix}`, ['layout-metadata-rendered']);
}
for (const suffix of ['', '/@name']) verify('/page/head/meta[5]' + suffix, ['layout-metadata-key-emitted']);
verify('/page/head/meta[5]/@content', ['layout-metadata-content-fallback'], false);
for (const element of ['html', 'head', 'body']) {
    for (const suffix of ['', '/@value']) verify(`/page/${element}/attribute${suffix}`, ['layout-page-attribute-rendered']);
}
for (const element of ['head', 'body']) verify(`/page/${element}/attribute/@name`, ['layout-page-attribute-rendered']);
console.log('Verified original metadata getter paths, derived operands, title fallback and raw attribute emission.');
