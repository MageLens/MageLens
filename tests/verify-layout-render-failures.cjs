// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const mode = process.argv[3] || 'developer';
assert.ok(['developer', 'production'].includes(mode));
for (const name of ['empty', 'missing', 'throw']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_renderfailure_${name}.xml`));
    assert.ok(file, name);
    const template = file.declarations.find(item => item.layout.kind === 'template');
    const types = [...new Set(template.evidence.map(event => event.type))].sort();
    assert.deepEqual(types, name === 'empty' ? ['layout-template-executed', 'layout-template-selected']
        : name === 'throw' || mode === 'developer' ? ['layout-template-failed', 'layout-template-selected']
        : ['layout-template-origin-unconfirmed', 'layout-template-selected'], name);
    const block = file.declarations.find(item => item.layout.kind === 'block');
    assert.equal(block.evidence.some(event => event.type === 'layout-block-rendered'),
        name === 'empty' || (name === 'missing' && mode === 'production'), name);
}
console.log(`Verified empty template execution, missing-file validation and throwing template boundaries in ${mode} mode.`);
