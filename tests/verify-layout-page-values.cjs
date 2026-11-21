// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const directory = 'app/code/MageLens/Compatibility/view/frontend/layout';
for (const [handle, node, state, effects] of [
    ['head', '/page/html/attribute', 'covered', ['layout-page-attribute-rendered']],
    ['head', '/page/head/attribute', 'covered', ['layout-page-attribute-rendered']],
    ['head', '/page/body/attribute[1]', 'covered', ['layout-page-attribute-rendered']],
    ['head', '/page/head/meta[1]', 'unmeasured', ['layout-metadata-overridden']],
    ['head', '/page/head/meta[2]', 'covered', ['layout-metadata-rendered']],
    ['head_overlay', '/page/head/meta', 'covered', ['layout-metadata-rendered']],
]) {
    const source = report.files.find(item => item.path === `${directory}/coverageprobe_layout_${handle}.xml`);
    for (const suffix of ['', '/@name', node.includes('/meta') ? '/@content' : '/@value']) {
        const item = source?.declarations.find(item => item.node === node + suffix);
        assert.ok(item, `Missing original page value ${handle}/${node}${suffix}`);
        assert.equal(item.state, state, `${handle}/${node}${suffix}`);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), effects);
    }
}
console.log('Verified effective HTML, head and body attributes, custom metadata and overridden description origins.');
