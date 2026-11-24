// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const layout = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_page_values_';

function verify(variant, node, effect, covered, fields = []) {
    const file = report.files.find(file => file.path === `${layout}${variant}.xml`);
    assert.ok(file, `Missing ${variant} page configuration source`);
    for (const path of [node, ...fields.map(field => `${node}/@${field}`)]) {
        const item = file.declarations.find(item => item.node === path);
        assert.ok(item, `Missing declaration ${variant} ${path}`);
        assert.equal(item.state, covered ? 'covered' : 'unmeasured', `${variant} ${path}`);
        assert.equal(item.hits > 0, covered, `${variant} ${path}`);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))], [effect], `${variant} ${path}`);
    }
}

verify('base', '/page/head/title', 'layout-title-overridden', false);
verify('falsy', '/page/head/title', 'layout-title-empty-ignored', false);
for (const index of [1, 2]) {
    verify('base', `/page/head/meta[${index}]`, 'layout-metadata-overridden', false, ['name', 'content']);
    verify('falsy', `/page/head/meta[${index}]`, 'layout-metadata-empty-suppressed', false, ['name', 'content']);
}
verify('falsy', '/page/head/meta[3]', 'layout-metadata-rendered', true, ['name', 'content']);
verify('falsy', '/page/head/meta[4]', 'layout-metadata-rendered', true, ['content']);
for (const [element, same] of [['html', 'attribute'], ['head', 'attribute[1]']]) {
    verify('base', `/page/${element}/attribute`, 'layout-page-attribute-removed-before-output', false, ['name', 'value']);
    verify('falsy', `/page/${element}/${same}`, 'layout-page-attribute-removed', true, ['name', 'value']);
}
verify('base', '/page/body/attribute', 'layout-page-attribute-overridden', false, ['name', 'value']);
verify('falsy', '/page/head/attribute[2]', 'layout-page-attribute-removal-target-missing', false, ['name', 'value']);
verify('falsy', '/page/body/attribute[1]', 'layout-page-attribute-removed', true, ['name']);
verify('falsy', '/page/body/attribute[2]', 'layout-page-attribute-removed-before-output', false, ['name', 'value']);
verify('falsy', '/page/body/attribute[3]', 'layout-page-attribute-rendered', true, ['name', 'value']);
verify('base', '/page/head/link', 'layout-asset-removed-before-output', false, ['src', 'src_type', 'rel']);
verify('falsy', '/page/head/remove', 'layout-asset-removed', true, ['src']);
console.log('Verified original page attribute removal, empty output decisions, metadata identities and empty asset removal.');
