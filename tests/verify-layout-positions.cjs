// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_anonymous_index.xml'));
for (const [node, state, type] of [
    ['/layout/container/@name', 'covered', 'layout-position-name-applied'],
    ['/layout/container/container/block/@as', 'covered', 'layout-position-alias-applied'],
    ['/layout/container/block[1]/@before', 'unmeasured', 'layout-position-ignored'],
    ['/layout/container/block[1]/@after', 'covered', 'layout-position-order-applied'],
    ['/layout/container/block[2]/@before', 'covered', 'layout-position-order-applied'],
    ['/layout/container/block[3]/@after', 'unmeasured', 'layout-position-order-unchanged'],
]) {
    const item = file?.declarations.find(item => item.node === node);
    assert.equal(item?.state, state, node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], [type], node);
}
const structure = report.files.find(file => file.path.endsWith('/layout/coverageprobe_layout_structure.xml'));
const original = structure?.declarations.find(item => item.layout.element === 'magelens.layout.moved' && item.layout.attribute === 'as');
assert.equal(original?.state, 'unmeasured');
assert.equal(original.hits, 0);
assert.deepEqual([...new Set(original.evidence.map(event => event.type))], ['layout-position-replaced']);
console.log('Verified native identity/alias application, sibling ordering, after precedence, unchanged edge ordering and moved alias replacement.');
