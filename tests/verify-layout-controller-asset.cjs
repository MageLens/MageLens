// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const source = report.files.find(file => file.path === 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_page_controller_asset.xml');
assert.ok(source, 'Missing controller asset source');
for (const [suffix, effects] of [
    ['', ['layout-asset-reference-rendered']],
    ['/@src', ['layout-asset-controller-url-generated', 'layout-asset-reference-rendered']],
    ['/@src_type', ['layout-asset-controller-url-generated', 'layout-asset-reference-rendered']],
    ['/@rel', ['layout-asset-attribute-emitted']],
    ['/@order', ['layout-asset-group-applied']],
]) {
    const node = '/page/head/link' + suffix;
    const declaration = source.declarations.find(item => item.node === node);
    assert.ok(declaration, `Missing controller asset operand ${node}`);
    assert.equal(declaration.state, 'covered', node);
    assert.ok(declaration.hits > 0, node);
    assert.deepEqual([...new Set(declaration.evidence.map(event => event.type))].sort(), effects, node);
}
console.log('Verified original controller-route, URL generation, grouping and asset reference evidence.');
