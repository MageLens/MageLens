// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const source = report.files.find(file => file.path.endsWith('/layout/coverageprobe_templatevalues.xml'));
assert.ok(source, 'Missing native direct-template fixture');
for (const [position, operand] of [[14, '/@template'], [15, '/arguments/argument'], [16, '/action/argument']]) {
    const parent = `/layout/container/block[${position}]`;
    const field = source.declarations.find(item => item.node === parent + operand);
    assert.ok(field, parent + operand);
    assert.ok(field.evidence.some(event => event.type === 'layout-template-selected'), field.node);
    assert.equal(field.evidence.some(event => event.type === 'layout-template-executed'), false, field.node);
    assert.ok(field.evidence.some(event => event.type === 'layout-template-field-access-unconfirmed'), field.node);
    if (position === 14) {
        assert.equal(field.hits, 0, field.node);
        assert.equal(field.state, 'unmeasured', field.node);
    }
    const block = source.declarations.find(item => item.node === parent);
    assert.ok(block.evidence.some(event => event.type === 'layout-block-rendered'), parent);
}
console.log('Verified direct PHP field writes cannot inherit XML template execution, independently of block and value evidence.');
