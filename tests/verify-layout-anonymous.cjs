// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_anonymous_index.xml'));
function verify(node, effects) {
    const item = file?.declarations.find(item => item.node === node);
    assert.equal(item?.state, 'covered', node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), effects.sort(), node);
}
verify('/layout/container/container', ['layout-container-created']);
verify('/layout/container/container/@htmlTag', ['layout-container-wrapper-rendered']);
verify('/layout/container/container/@htmlId', ['layout-container-wrapper-rendered']);
verify('/layout/container/container/@label', ['layout-container-label-applied', 'layout-container-label-read']);
verify('/layout/container/container/block', ['layout-block-created', 'layout-block-rendered']);
verify('/layout/container/container/block/@template', ['layout-template-executed', 'layout-template-selected']);
for (const item of file.declarations.filter(item => item.layout.attribute === 'output')) {
    assert.equal(item.state, 'unmeasured');
    assert.equal(item.hits, 0);
    assert.match(item.reason, /root containers/);
}
const detached = file.declarations.find(item => item.layout.kind === 'block'
    && item.layout.element === 'magelens.layout.unselected.output');
assert.deepEqual([...new Set(detached?.evidence.map(event => event.type))], ['layout-block-created']);
assert.equal(detached.state, 'uncovered');
assert.equal(detached.hits, 0);
console.log('Verified native anonymous block/container attribution, label application/read, and ignored output attributes.');
