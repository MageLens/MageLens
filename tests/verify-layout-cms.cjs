// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(file => file.path.endsWith('/layout/cms_page_view_id_magelens_layout_cms_fixture.xml'));
assert.ok(file);
const effects = node => {
    const item = file.declarations.find(item => item.node === node);
    assert.ok(item, node);
    return [...new Set(item.evidence.map(event => event.type))].sort();
};
assert.deepEqual(effects('/page/@layout'), ['layout-wireframe-origin-unconfirmed']);
assert.deepEqual(effects('/page/head/title'), ['layout-title-replaced']);
assert.deepEqual(effects('/page/body/referenceContainer/block'), ['layout-block-created', 'layout-block-rendered']);
assert.deepEqual(effects('/page/body/referenceContainer/block/@template'),
    ['layout-template-executed', 'layout-template-selected']);
assert.ok(effects('/page/body/referenceContainer/block/arguments/argument[2]').includes('layout-argument-read'));
assert.deepEqual(effects('/page/body/referenceBlock/@template'), ['layout-template-executed', 'layout-template-selected']);
const selected = report.files.find(file => file.path.endsWith('/layout/cms_page_view_selectable_magelens_layout_cms_fixture_selected.xml'));
assert.ok(selected);
assert.ok(selected.declarations.find(item => item.layout.kind === 'block').evidence
    .some(event => event.type === 'layout-block-rendered'));
assert.ok(report.layout.limitations.some(reason => reason.includes('CMS layout update')));
console.log('Verified original CMS entity and selectable layout effects independently of inline database values and page selection.');
