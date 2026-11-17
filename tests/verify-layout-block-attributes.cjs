// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
for (const [handle, attribute, state, effect] of [
    ['structure', 'class', 'unmeasured', 'layout-block-attribute-overridden'],
    ['structure_restore', 'class', 'covered', 'layout-block-class-applied'],
    ['structure', 'group', 'unmeasured', 'layout-block-attribute-overridden'],
    ['structure_restore', 'group', 'covered', 'layout-block-group-applied'],
    ['structure', 'ttl', 'covered', 'layout-block-ttl-applied'],
]) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_layout_${handle}.xml`));
    const item = file?.declarations.find(item => item.layout?.element === 'magelens.layout.anchor' && item.layout.attribute === attribute);
    assert.ok(item, `Missing original ${attribute} ${handle}`);
    assert.equal(item.state, state);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], [effect]);
}
console.log('Verified independent class, group and TTL application and equal-valued class override ownership.');
