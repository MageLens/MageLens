// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
for (const [handle, node, attributes, state, effect] of [
    ['head', '/page/head/script[1]', ['defer', 'async', 'charset', 'type'], 'covered', 'layout-asset-attribute-emitted'],
    ['head', '/page/head/script[2]', ['ie_condition'], 'covered', 'layout-asset-condition-rendered'],
    ['head', '/page/head/link', ['rel', 'hreflang', 'charset', 'media', 'rev', 'sizes', 'target', 'type', 'integrity', 'crossorigin', 'as', 'defer'], 'covered', 'layout-asset-attribute-emitted'],
    ['head', '/page/head/font', ['as', 'crossorigin'], 'unmeasured', 'layout-asset-attributes-discarded'],
    ['head_overlay', '/page/head/css[1]', ['media'], 'covered', 'layout-asset-attribute-emitted'],
    ['head_overlay', '/page/head/css[1]', ['order'], 'covered', 'layout-asset-group-applied'],
    ['head_overlay', '/page/head/css[2]', ['order'], 'covered', 'layout-asset-group-applied'],
]) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_layout_${handle}.xml`));
    for (const attribute of attributes) {
        const item = file?.declarations.find(item => item.node === `${node}/@${attribute}`);
        assert.ok(item, `Missing asset attribute ${handle}/${node}/@${attribute}`);
        assert.equal(item.state, state, `${handle}/${node}/@${attribute}`);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))], [effect]);
    }
}
console.log('Verified original serialized asset attributes, native order grouping, conditional output and discarded font attributes.');
