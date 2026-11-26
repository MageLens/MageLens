// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');

const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const layout = 'app/code/MageLens/Compatibility/view/frontend/layout';
for (const [handle, node, state, effects] of [
    ['coverageprobe_layout_head', '/page/head/title', 'unmeasured', ['layout-title-overridden']],
    ['coverageprobe_layout_head_overlay', '/page/head/title', 'covered', ['layout-title-rendered']],
    ['coverageprobe_layout_head_overlay', '/page/head/remove[1]/@src', 'covered', ['layout-asset-removed']],
    ['coverageprobe_layout_head_overlay', '/page/head/remove[2]/@src', 'unmeasured', ['layout-asset-removal-target-missing']],
]) {
    const file = report.files.find(file => file.path === `${layout}/${handle}.xml`);
    assert.ok(file, `Missing head source ${handle}`);
    const item = file.declarations.find(item => item.node === node);
    assert.ok(item, `Missing head declaration ${node}`);
    assert.equal(item.state, state, `${handle} ${node}`);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], effects, `${handle} ${node}`);
    assert.equal(item.hits > 0, state === 'covered', `${handle} ${node}`);
}
console.log('Verified the rendered and superseded titles, one effective removal and one absent removal target.');
