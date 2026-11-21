// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_layout_arguments.xml'));
for (const [name, read] of [['visited', true], ['unread', false], ['nullable', false], ['leaf', true]]) {
    const item = file?.declarations.find(item => item.layout.kind === 'argument' && item.layout.element === name
        && item.node.startsWith('/page/body/referenceContainer/block/arguments/argument[23]/'));
    assert.ok(item, name);
    assert.equal(item.evidence.some(event => event.type === 'layout-argument-read'), read, name);
    assert.ok(item.evidence.some(event => event.type === 'layout-argument-applied'), name);
}
for (const name of ['lines', 'literal/slash']) {
    const item = file?.declarations.find(item => item.layout.kind === 'argument' && item.layout.element === name);
    assert.ok(item?.evidence.some(event => event.type === 'layout-argument-read'), name);
}
console.log('Verified native indexed array and string reads, literal slash keys, and unconsumed nullable/absent indexes.');
