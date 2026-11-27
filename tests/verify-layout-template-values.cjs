// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_templatevalues.xml'));
assert.ok(file);
function item(node) {
    const declaration = file.declarations.find(item => item.node === node);
    assert.ok(declaration, node);
    return declaration;
}
function has(node, type) { return item(node).evidence.some(event => event.type === type); }
for (const [position, action, executed] of [[1, false, true], [2, true, true], [3, true, true],
    [4, false, false], [5, false, false], [6, true, false], [7, false, false], [8, false, false],
    [9, true, false], [10, true, false], [11, false, true], [12, true, true], [13, false, true], [null, false, false]]) {
    const block = position === null ? '/layout/block' : `/layout/container/block[${position}]`;
    const value = block + (action ? '/action/argument' : '/arguments/argument');
    assert.equal(item(value).layout.kind, action ? 'action-argument' : 'argument');
    assert.equal(has(value, 'layout-template-selected'), true, value);
    assert.equal(has(value, 'layout-template-executed'), executed, value);
    assert.equal(item(value).hits > 0, true, value);
    if (action) assert.equal(has(block + '/action', 'layout-action-executed'), true, block);
    if (position === 4) assert.equal(has(value, 'layout-template-overridden'), true, value);
    if ([5, 6].includes(position)) assert.equal(has(value, 'layout-template-replaced'), true, value);
    assert.equal(has(block, 'layout-block-rendered'), position !== null, block);
}
assert.equal(has('/layout/container/block[3]/@template', 'layout-template-executed'), false);
assert.equal(has('/layout/container/block[3]/@template', 'layout-template-overridden'), true);
assert.equal(has('/layout/container/block[4]/@template', 'layout-template-executed'), true);
console.log('Verified independent native XML argument/action template selections, execution, equal XML/PHP replacements, false values and unrendered blocks.');
