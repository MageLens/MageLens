// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');

const theme = 'adminhtml/Magento/backend';
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
for (const [handle, block] of [['edit', 'application.blog.edit'], ['index', 'application.blog.manage']]) {
    const path = `app/code/Application/Blog/view/adminhtml/layout/application_blog_manage_${handle}.xml`;
    const file = report.files.find(item => item.path === path);
    assert.ok(file, `Missing Admin layout file ${path}`);
    for (const [kind, element, effects] of [
        ['wireframe-selection', '', ['layout-wireframe-selected']],
        ['block', block, ['layout-block-created', 'layout-block-rendered']],
        ['template', block, ['layout-template-executed', 'layout-template-selected']],
    ]) {
        const matches = file.declarations.filter(item => item.layout?.kind === kind && item.layout.element === element);
        assert.equal(matches.length, 1, `${handle}/${kind}`);
        const [item] = matches;
        assert.equal(item.state, 'covered', `${handle}/${kind}`);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), effects, `${handle}/${kind}`);
        assert.deepEqual([...new Set(item.evidence.map(event => `${event.area}:${event.theme}`))], [`adminhtml:${theme}`], `${handle}/${kind}`);
    }
}
console.log(`Verified original Blog Admin layout declarations in ${theme}.`);
