// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const base = report.files.find(file => file.path === 'app/code/MageLens/Compatibility/view/frontend/layouts.xml');
const overlay = report.files.find(file => file.path === 'app/code/MageLens/LayoutOverlay/view/frontend/layouts.xml');
function label(file, id) {
    const entry = file.declarations.find(item => item.layout.instruction === 'layout' && item.layout.element === id
        && item.layout.attribute === null);
    assert.ok(entry, id);
    return file.declarations.find(item => item.node === entry.node + '/label');
}
for (const [file, id] of [[base, 'magelens_fixture'], [base, 'magelens_registry_empty'],
    [overlay, 'magelens_registry_override'], [overlay, 'magelens_registry_equal'], [overlay, 'magelens_registry_cdata'], [base, 'magelens_registry_mixed'],
    [overlay, 'magelens_registry_mixed'], [overlay, 'magelens_registry_cdata_equal']]) {
    const item = label(file, id);
    assert.equal(item?.state, 'covered', id);
    assert.ok(item.evidence.some(event => event.type === 'layout-registry-label-consumed'), id);
}
for (const id of ['magelens_registry_override', 'magelens_registry_equal', 'magelens_registry_cdata', 'magelens_registry_cdata_equal']) {
    const item = label(base, id);
    assert.equal(item.state, 'unmeasured', id);
    assert.equal(item.hits, 0);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-registry-overridden']);
}
const empty = label(overlay, 'magelens_registry_empty');
assert.equal(empty.state, 'unmeasured');
assert.equal(empty.hits, 0);
assert.deepEqual([...new Set(empty.evidence.map(event => event.type))], ['layout-registry-label-ignored']);
for (const file of [base, overlay]) {
    for (const item of file.declarations.filter(item => item.layout.kind === 'registry-entry')) {
        assert.equal(item.state, 'covered', item.layout.element);
    }
}
const flag = base.declarations.find(item => item.layout.attribute === 'translate');
assert.equal(flag.state, 'unmeasured');
assert.equal(flag.hits, 0);
assert.match(flag.reason, /flag/);
assert.ok(label(base, 'magelens_fixture').evidence.some(event => event.type === 'layout-registry-snapshot-returned'));
console.log('Verified native registry entry/label ownership, equal-valued replacement, empty-node retention, empty CDATA clearing, mixed-source label fragments and zero-hit snapshot observations.');
