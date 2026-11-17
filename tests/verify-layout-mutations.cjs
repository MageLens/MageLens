// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
for (const name of ['native', 'direct', 'clone', 'replace']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_mutation_${name}.xml`));
    assert.ok(file, name);
    for (const item of file.declarations.filter(item => item.supported)) {
        if (item.layout.kind === 'file-selection') {
            assert.equal(item.state, 'covered', name);
            assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-file-selected']);
        } else if (name === 'native') {
            assert.equal(item.state, 'covered', item.node);
        } else {
            assert.equal(item.hits, 0, `${name}/${item.node}`);
            assert.equal(item.state, 'unmeasured', `${name}/${item.node}`);
            assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-xml-ownership-revoked']);
        }
    }
}
assert.ok(report.layout.limitations.some(reason => reason.includes('mutable layout XML')));
console.log('Verified native XML ownership and zero inferred hits after direct mutation, equal clone replacement or public XML reassignment.');
