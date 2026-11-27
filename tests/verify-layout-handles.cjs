// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));

const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const platform = process.argv[3];
assert.ok(['magento', 'mageos'].includes(platform), 'Specify the pinned platform as the third argument');
const directory = 'app/code/MageLens/Compatibility/view/frontend/layout';

function include(file, handle, effect, state) {
    const source = report.files.find(item => item.path === `${directory}/${file}.xml`);
    assert.ok(source, `Missing layout source ${file}`);
    const declarations = source.declarations.filter(item => item.layout?.kind === 'include' && item.layout.element === handle);
    assert.equal(declarations.length, 1, `Missing include origin for ${file}/${handle}`);
    const [declaration] = declarations;
    assert.equal(declaration.state, state);
    assert.deepEqual([...new Set(declaration.evidence.map(item => item.type))], [effect]);
    assert.ok(declaration.evidence.every(item => item.area === 'frontend'));
}

include('coverageprobe_handle_index', 'coverageprobe_layout_nested', 'layout-include-traversed', 'covered');
include('coverageprobe_handle_index', 'coverageprobe_layout_repeat', 'layout-include-duplicate', 'unmeasured');
include('coverageprobe_layout_nested', 'coverageprobe_layout_repeat', 'layout-include-traversed', 'covered');
include('coverageprobe_layout_repeat', 'coverageprobe_layout_nested', 'layout-include-cycle', 'unmeasured');
console.log('Verified exact source for traversed, duplicate and cyclic layout include edges.');

function selected(file, kind, state, effect) {
    const source = report.files.find(item => item.path === file);
    assert.ok(source, `Missing wireframe source ${file}`);
    const matches = source.declarations.filter(item => item.layout?.kind === kind);
    assert.equal(matches.length, 1, `Missing unique ${kind} origin for ${file}`);
    assert.equal(matches[0].state, state);
    assert.deepEqual([...new Set(matches[0].evidence.map(item => item.type))], [effect]);
}
selected(`${directory}/coverageprobe_handle_index.xml`, 'wireframe-selection', 'covered', 'layout-wireframe-selected');
selected('app/code/MageLens/Compatibility/view/frontend/page_layout/magelens_fixture.xml', 'wireframe', 'covered', 'layout-wireframe-selected');
console.log('Verified the page layout selector evidence boundary and the selected wireframe.');
