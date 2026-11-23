// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const name of ['native', 'equal']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_packagemutation_${name}.xml`));
    assert.ok(file, name);
    for (const item of file.declarations.filter(item => item.supported || item.layout.kind === 'file-selection')) {
        if (item.layout.kind === 'file-selection') {
            assert.equal(item.state, 'unmeasured', name);
            assert.equal(item.hits, 0);
            assert.deepEqual([...new Set(item.evidence.map(event => event.type))],
                [name === 'native' ? 'layout-file-selected' : 'layout-xml-ownership-revoked']);
        } else if (name === 'native') {
            assert.equal(item.state, 'covered', item.node);
        } else {
            assert.equal(item.hits, 0, `${name}/${item.node}`);
            assert.equal(item.state, 'unmeasured', `${name}/${item.node}`);
            assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-xml-ownership-revoked']);
        }
    }
}
for (const suffix of ['/layout/coverageprobe_packagemutation_unused.xml', '/layout/coverageprobe_selector_index.xml',
    '/page_layout/magelens_selector.xml']) {
    const file = report.files.find(file => file.path.endsWith(suffix));
    assert.ok(file, suffix);
    for (const item of file.declarations) {
        assert.equal(item.hits, 0, `${suffix}/${item.node}`);
        assert.deepEqual(item.evidence, [], `${suffix}/${item.node}`);
        if (item.supported) assert.equal(item.state, 'uncovered', `${suffix}/${item.node}`);
    }
}
assert.ok(report.layout.limitations.some(reason => reason.includes('mutable package layout XML')));
console.log('Verified native XML package ownership and zero original-source hits after external exposure and equal DOM replacement.');
