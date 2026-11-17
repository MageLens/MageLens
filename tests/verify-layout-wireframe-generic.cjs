// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const wireframe = report.files.find(file => file.path.endsWith('/page_layout/magelens_fixture.xml'));
for (const [name, kind, events] of [
    ['magelens.layout.wireframe', 'container', ['layout-container-created']],
    ['magelens.layout.wireframe', 'container-htmlTag', ['layout-container-wrapper-rendered']],
    ['magelens.layout.wireframe.nested-block', 'block', ['layout-block-created', 'layout-block-rendered']],
    ['magelens.layout.wireframe.nested-block', 'template', ['layout-template-executed', 'layout-template-selected']],
    ['magelens.layout.wireframe.movable', 'move', ['layout-move-applied']],
    ['magelens.layout.wireframe.removed', 'removal', ['layout-removal-applied']],
]) {
    const item = wireframe?.declarations.find(item => item.layout.element === name && item.layout.kind === kind);
    assert.equal(item?.state, 'covered', `${name}/${kind}`);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), events.sort());
}
for (const item of wireframe.declarations.filter(item => /\/layout\/(head|body)(\/|$)/.test(item.node))) {
    assert.equal(item.state, 'unmeasured', item.node);
    assert.equal(item.hits, 0);
    assert.match(item.reason, /wireframe.*head and body/);
}
const generic = report.files.find(file => file.path.endsWith('/layout/coverageprobe_generic_index.xml'));
for (const kind of ['action', 'action-argument', 'argument', 'move', 'removal']) {
    const items = generic?.declarations.filter(item => item.layout.kind === kind);
    assert.ok(items?.length, kind);
    for (const item of items) assert.equal(item.state, 'covered', item.node);
}
console.log('Verified original wireframe container/block/render/move/removal evidence, ignored root wrappers, and generic actions/values/structure.');
