// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const root = 'app/code/MageLens/Compatibility/view/frontend';
for (const [path, type] of [
    ['layout/coverageprobe_handle_index.xml', 'page'],
    ['layout/coverageprobe_fragment_index.xml', 'generic'],
    ['page_layout/magelens_fixture.xml', 'wireframe'],
]) {
    const file = report.files.find(file => file.path === `${root}/${path}`);
    assert.ok(file, path);
    const hints = file.declarations.filter(item => item.layout?.attribute === 'xsi:noNamespaceSchemaLocation');
    assert.equal(hints.length, 1, path);
    const [hint] = hints;
    assert.equal(hint.layout.fileType, type, path);
    assert.equal(hint.layout.kind, 'schema-hint', path);
    assert.equal(hint.state, 'unmeasured', path);
    assert.equal(hint.hits, 0, path);
    assert.deepEqual(hint.evidence, [], path);
    assert.match(hint.reason, /Native file packaging omits this namespaced schema hint/, path);
}
console.log('Verified page, generic and wireframe schema hints retain their original location and explicit zero-hit native limitation.');
