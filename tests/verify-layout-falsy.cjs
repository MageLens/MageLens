// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
function field(handle, element, attribute, kind, state, types) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_falsy_${handle}.xml`));
    const item = file?.declarations.find(item => item.layout.element === 'magelens.falsy.' + element
        && item.layout.attribute === attribute && (attribute !== null || item.layout.kind === kind));
    const label = `${handle}/${element}/${attribute || kind}`;
    assert.ok(item, label);
    assert.equal(item.layout.kind, kind, label);
    assert.equal(item.supported, true, label);
    assert.equal(item.state, state, label);
    assert.equal(item.hits > 0, state === 'covered', label);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), types.sort(), label);
    return item;
}
field('base', 'native', 'template', 'template', 'covered', ['layout-template-selected', 'layout-template-executed']);
field('base', 'native', 'group', 'block-group', 'covered', ['layout-block-group-applied']);
field('base', 'native', 'ttl', 'block-ttl', 'covered', ['layout-block-ttl-applied']);
for (const element of ['padded', 'signed']) field('base', element, 'ttl', 'block-ttl', 'covered', ['layout-block-ttl-applied']);
field('base', 'padded', 'group', 'block-group', 'covered', ['layout-block-group-applied']);
for (const element of ['zero', 'empty']) {
    field('base', element, 'template', 'template', 'unmeasured', ['layout-template-empty-ignored']);
    field('base', element, 'group', 'block-group', 'unmeasured', ['layout-block-group-empty-ignored']);
    field('base', element, 'ttl', 'block-ttl', 'unmeasured', ['layout-block-ttl-empty-ignored']);
    field('base', element, null, 'block', 'covered', ['layout-block-created', 'layout-block-rendered']);
}
for (const element of ['override.zero', 'override.empty']) {
    field('base', element, 'template', 'template', 'unmeasured', ['layout-template-overridden']);
    field('overlay', element, 'template', 'template', 'unmeasured', ['layout-template-empty-ignored']);
    field('base', element, null, 'block', 'covered', ['layout-block-created', 'layout-block-rendered']);
}
field('overlay', 'native', 'display', 'block-display', 'covered', ['layout-display-allowed']);
field('overlay', 'zero', 'display', 'block-display', 'unmeasured', ['layout-display-empty-ignored']);
field('overlay', 'false', 'display', 'block-display', 'covered', ['layout-display-denied']);
field('overlay', 'hidden', 'display', 'container-display', 'covered', ['layout-display-denied']);
field('base', 'hidden.child', null, 'block', 'uncovered', ['layout-block-created']);
field('base', 'wrapper', 'htmlClass', 'container-htmlClass', 'covered', ['layout-container-wrapper-zero-class-emitted']);
field('base', 'wrapper', 'label', 'container-label', 'covered', ['layout-container-label-applied', 'layout-container-label-read']);
for (const target of ['block', 'container']) {
    field('base', 'removed.' + target, 'remove', 'removal', 'covered', ['layout-removal-applied']);
    field('overlay', 'removed.' + target, 'remove', 'removal', 'unmeasured', ['layout-removal-empty-ignored']);
    field('base', 'restored.' + target, 'remove', 'removal', 'unmeasured', ['layout-removal-canceled']);
    field('overlay', 'restored.' + target, 'remove', 'removal', 'covered', ['layout-removal-restored']);
    const reference = field('base', 'restored.' + target, null, 'reference', 'unmeasured',
        ['layout-reference-target-observed', 'layout-removal-canceled']);
    assert.match(reference.reason, /canceled/);
}
for (const [attribute, kind] of [['template', 'template'], ['group', 'block-group'], ['ttl', 'block-ttl']]) {
    field('unvisited', 'unvisited', attribute, kind, 'uncovered', []);
}
const cacheable = report.files.find(file => file.path.endsWith('/layout/coverageprobe_falsy_base.xml')).declarations
    .find(item => item.layout.element === 'magelens.falsy.zero' && item.layout.attribute === 'cacheable');
assert.equal(cacheable.state, 'unmeasured');
assert.equal(cacheable.hits, 0);
assert.match(cacheable.reason, /literal false/);
console.log('Verified native empty block attributes, zero display/removal semantics, malformed zero-class interpolation and unvisited operands.');
