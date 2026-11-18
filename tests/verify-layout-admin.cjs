// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');

const platform = process.argv[2];
const theme = {magento: 'adminhtml/Magento/backend', mageos: 'adminhtml/MageOS/m137-admin-theme'}[platform];
assert.ok(theme, 'Specify magento or mageos as the first argument');
const report = JSON.parse(fs.readFileSync(process.argv[3] || 'coverage/xml/coverage.json'));
for (const [handle, block] of [['edit', 'application.blog.edit'], ['index', 'application.blog.manage']]) {
    const path = `app/code/Application/Blog/view/adminhtml/layout/application_blog_manage_${handle}.xml`;
    const file = report.files.find(item => item.path === path);
    assert.ok(file, `Missing Admin layout file ${path}`);
    for (const [kind, element, effects] of [
        ['wireframe-selection', '', [platform === 'mageos' ? 'layout-wireframe-origin-unconfirmed' : 'layout-wireframe-selected']],
        ['block', block, ['layout-block-created', 'layout-block-rendered']],
        ['template', block, ['layout-template-executed', 'layout-template-selected']],
    ]) {
        const matches = file.declarations.filter(item => item.layout?.kind === kind && item.layout.element === element);
        assert.equal(matches.length, 1, `${handle}/${kind}`);
        const [item] = matches;
        assert.equal(item.state, platform === 'mageos' && kind === 'wireframe-selection' ? 'unmeasured' : 'covered', `${handle}/${kind}`);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), effects, `${handle}/${kind}`);
        assert.ok(item.evidence.every(event => event.area === 'adminhtml' && event.theme === theme));
    }
}
console.log(`Verified original Blog Admin layout declarations in ${theme}.`);
