// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const module of ['Compatibility', 'LayoutOverlay']) {
    const file = report.files.find(file => file.path === `app/code/MageLens/${module}/etc/frontend/page_types.xml`);
    assert.ok(file, module);
    assert.equal(file.declarations.filter(item => item.layout.kind === 'page-type').length, 2);
    assert.equal(file.declarations.filter(item => ['page-type-id', 'page-type-label'].includes(item.layout.kind)).length, 4);
    for (const item of file.declarations.filter(item => item.layout.kind === 'page-type')) {
        assert.equal(item.state, 'covered');
        assert.ok(item.evidence.some(event => event.type === 'layout-page-type-applied'));
    }
    for (const item of file.declarations.filter(item => ['page-type-id', 'page-type-label'].includes(item.layout.kind))) {
        if (module === 'Compatibility') {
            assert.equal(item.hits, 0);
            assert.equal(item.state, 'unmeasured');
            assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-registry-overridden']);
        } else {
            assert.equal(item.state, 'covered');
            assert.ok(item.evidence.some(event => event.type === 'layout-page-type-applied'));
            if (item.layout.kind === 'page-type-label' || item.layout.element === 'magelens_page_type_fixture') {
                assert.ok(item.evidence.some(event => event.type === 'layout-page-type-read'));
            } else {
                assert.ok(item.evidence.every(event => event.type !== 'layout-page-type-read'));
            }
        }
    }
}
console.log('Verified native page-type creation, translated-label application, exact getter reads and equal-valued field overrides.');
