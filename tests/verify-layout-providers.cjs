// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const moduleRoot = 'app/code/MageLens/Compatibility';
const themes = 'app/design/frontend/MageLens';
for (const [path, name, theme] of [
    [`${moduleRoot}/view/base/layout/coverageprobe_theme_index.xml`, 'base', 'frontend/MageLens/child'],
    [`${moduleRoot}/view/frontend/layout/coverageprobe_theme_index.xml`, 'frontend', 'frontend/MageLens/child'],
    ['app/code/MageLens/LayoutOverlay/view/frontend/layout/coverageprobe_theme_index.xml', 'overlay', 'frontend/MageLens/child'],
    [`${themes}/parent/MageLens_Compatibility/layout/coverageprobe_theme_index.xml`, 'parent', 'frontend/MageLens/child'],
    [`${themes}/child/MageLens_Compatibility/layout/coverageprobe_theme_index.xml`, 'child', 'frontend/MageLens/child'],
    [`${themes}/child/MageLens_Compatibility/layout/override/base/coverageprobe_theme_base_override.xml`, 'base-replacement', 'frontend/MageLens/child'],
    [`${themes}/child/MageLens_Compatibility/layout/override/theme/MageLens/parent/coverageprobe_theme_parent_override.xml`, 'parent-replacement', 'frontend/MageLens/child'],
]) {
    const file = report.files.find(file => file.path === path);
    const item = file?.declarations.find(item => item.layout?.kind === 'block'
        && item.layout.element === 'magelens.layout.provider.' + name);
    assert.equal(item?.state, 'covered', path);
    for (const type of ['layout-block-created', 'layout-block-rendered']) {
        assert.ok(item.evidence.some(event => event.type === type && event.theme === theme), `${path}/${type}`);
    }
}
const extended = report.files.find(file => file.path === `${moduleRoot}/view/frontend/layout/coverageprobe_theme_index.xml`);
assert.equal(extended.declarations.filter(item => item.layout.kind === 'include' && item.state === 'covered').length, 3,
    'Generic includes retain their original edges through theme replacement');
for (const path of [
    'override/base/coverageprobe_theme_base_override.xml',
    'override/base/coverageprobe_theme_empty_override.xml',
    'override/theme/MageLens/parent/coverageprobe_theme_parent_override.xml',
]) {
    const file = report.files.find(file => file.path === `${themes}/child/MageLens_Compatibility/layout/${path}`);
    const root = file?.declarations.find(item => item.node === '/layout');
    assert.equal(root?.state, 'covered', path);
    assert.ok(root.evidence.some(event => event.type === 'layout-file-override-selected'
        && event.theme === 'frontend/MageLens/child'), path);
}
const displaced = report.files.find(file => file.path === `${themes}/parent/MageLens_Compatibility/layout/coverageprobe_theme_parent_override.xml`);
const original = displaced?.declarations.find(item => item.layout.kind === 'block');
assert.equal(original?.state, 'unmeasured');
assert.equal(original.hits, 0);
assert.deepEqual([...new Set(original.evidence.map(event => event.type))], ['layout-file-overridden']);
assert.ok(!report.files.some(file => file.path.startsWith(`${themes}/inactive/`)), 'Inactive themes stay outside eligible roots');
console.log('Verified module base/area inputs, module sequence, inherited extension, base/theme/empty replacements and inactive providers.');
