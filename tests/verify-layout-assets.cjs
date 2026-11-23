// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const [handle, node, state, effect] of [
    ['head', '/page/head/css[1]', 'unmeasured', 'layout-asset-overridden'],
    ['head', '/page/head/css[2]', 'unmeasured', 'layout-asset-removed-before-output'],
    ['head', '/page/head/script[1]', 'covered', 'layout-asset-reference-rendered'],
    ['head', '/page/head/script[2]', 'covered', 'layout-asset-reference-rendered'],
    ['head', '/page/head/link', 'covered', 'layout-asset-reference-rendered'],
    ['head', '/page/head/font', 'covered', 'layout-asset-reference-rendered'],
    ['head_overlay', '/page/head/css[1]', 'covered', 'layout-asset-reference-rendered'],
    ['head_overlay', '/page/head/css[2]', 'covered', 'layout-asset-reference-rendered'],
]) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_layout_${handle}.xml`));
    for (const suffix of ['', '/@src']) {
        const item = file?.declarations.find(item => item.node === node + suffix);
        assert.ok(item, `Missing asset source ${handle}/${node}${suffix}`);
        assert.equal(item.state, state, `${handle}/${node}${suffix}`);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))], [effect]);
    }
}
console.log('Verified surviving, superseded and removed resource references through native asset output.');
