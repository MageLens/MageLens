// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(row => row.path.endsWith('/layout/coverageprobe_component_index.xml'));
assert.ok(file, 'Missing original UI condition source');

function verify(node, type, hits) {
    const item = file.declarations.find(row => row.node === node);
    assert.ok(item, `Missing original visibility operand ${node}`);
    assert.equal(item.state, hits ? 'covered' : 'unmeasured', node);
    assert.equal(item.hits > 0, hits, node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(),
        [type, 'layout-xml-ownership-revoked'].sort(), node);
}

const conditions = file.declarations.filter(item => item.layout.instruction === 'visibilityCondition' && !item.layout.attribute);
assert.equal(conditions.length, 7);
for (const condition of conditions) {
    const group = condition.node + '/arguments';
    verify(group, 'layout-argument-group-selected', true);
    const used = !['other_visibility', 'duck_visibility', 'magic_visibility'].includes(condition.layout.element);
    const values = file.declarations.filter(item => item.layout.kind === 'visibility-argument' && item.node.startsWith(group + '/'));
    assert.equal(values.length, 3, group);
    for (const value of values) {
        verify(value.node + '/@name', used ? 'layout-condition-argument-applied' : 'layout-condition-argument-unconsumed', used);
        verify(value.node + '/@xsi:type', 'layout-argument-type-evaluated', true);
    }
}
const direct = file.declarations.filter(item => item.node === '/layout/container/uiComponent[1]/argument'
    || item.node.startsWith('/layout/container/uiComponent[1]/argument/@'));
assert.equal(direct.length, 3);
for (const item of direct) {
    assert.equal(item.state, 'unmeasured', item.node);
    assert.equal(item.hits, 0, item.node);
    assert.match(item.reason, /UI layout reader does not forward direct component arguments/);
}
console.log('Verified independently observed visibility group selection, type dispatch and key delivery.');
