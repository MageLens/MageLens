// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const provider = report.files.find(file => file.path === 'app/code/MageLens/LayoutDisabled/view/frontend/layout/coverageprobe_theme_index.xml');
assert.ok(provider, 'Registered inactive provider disappeared from the original inventory');
const eligible = provider.declarations.filter(item => item.supported || item.layout.kind === 'file-selection');
assert.ok(eligible.some(item => item.layout.kind === 'block'));
assert.ok(eligible.some(item => item.layout.kind === 'template'));
for (const item of eligible) {
    assert.equal(item.state, 'unmeasured', item.node);
    assert.equal(item.hits, 0, item.node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-file-provider-excluded'], item.node);
}
console.log('Verified the registered inactive layout provider stays in the report with native exclusion evidence and zero hits.');
