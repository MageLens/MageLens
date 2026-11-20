// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
for (const [handle, node, state, effect] of [
    ['layout_head', '/page/body/attribute[2]', 'covered', 'layout-body-class-rendered'],
    ['layout_head_overlay', '/page/body/attribute[1]', 'unmeasured', 'layout-body-class-duplicate'],
    ['layout_head_overlay', '/page/body/attribute[2]', 'covered', 'layout-body-class-rendered'],
    ['classclear_index', '/page/body/attribute[1]', 'unmeasured', 'layout-body-class-canceled'],
    ['classclear_index', '/page/body/attribute[2]', 'covered', 'layout-body-classes-cleared'],
    ['classclear_index', '/page/body/attribute[3]', 'unmeasured', 'layout-body-class-canceled'],
]) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_${handle}.xml`));
    for (const suffix of ['', '/@name', '/@value']) {
        const item = file?.declarations.find(item => item.node === node + suffix);
        assert.ok(item, `Missing body class source ${handle}/${node}${suffix}`);
        assert.equal(item.state, state, `${handle}/${node}${suffix}`);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))], [effect]);
    }
}
console.log('Verified original body class output, sanitized values, duplicates and the irreversible native empty-class reset.');
