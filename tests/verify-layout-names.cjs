// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const scope = process.argv[3] || 'all';
const root = 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_names_';
function item(handle, kind, element) {
    const file = report.files.find(file => file.path === `${root}${handle}.xml`);
    assert.ok(file, handle);
    const matches = file.declarations.filter(item => item.layout.kind === kind && item.layout.element === element);
    assert.equal(matches.length, 1, `${handle}/${kind}/${element}`);
    return matches[0];
}
function effect(handle, kind, element, covered, types) {
    const found = item(handle, kind, element);
    assert.equal(found.hits > 0, covered, `${handle}/${kind}/${element}`);
    assert.deepEqual([...new Set(found.evidence.map(event => event.type))].sort(), types.sort(), `${handle}/${kind}/${element}`);
}
if (scope !== 'containers') {
    for (const name of ['123', '00123', '0', '', '124']) {
        const rendered = name !== '124' || scope !== 'blocks';
        effect('base', 'block', name, rendered, ['layout-block-created', ...(rendered ? ['layout-block-rendered'] : [])]);
    }
    effect('base', 'position-name', '0', false, ['layout-position-name-defaulted']);
    for (const name of ['123', '00123', '124', '300', '400']) {
        effect('base', 'position-name', name, true, ['layout-position-name-applied']);
    }
    effect('base', 'position-as', '123', false, []);
    effect('base', 'position-as', '00123', true, ['layout-position-alias-applied']);
    effect('base', 'template', '123', false, ['layout-template-overridden']);
    effect('overlay', 'template', '123', true, ['layout-template-selected', 'layout-template-executed']);
    for (const name of ['00123', '0', '', '124']) {
        const rendered = name !== '124' || scope !== 'blocks';
        effect('base', 'template', name, rendered, ['layout-template-selected', ...(rendered ? ['layout-template-executed'] : [])]);
    }
}
if (scope === 'all') {
    for (const kind of ['move', 'move-element', 'move-destination']) effect('move', kind, '124', true, ['layout-move-applied']);
    effect('move', 'move-as', '124', false, ['layout-move-alias-unchanged']);
    effect('move', 'move-after', '124', false, ['layout-move-order-unchanged']);
}
if (scope === 'containers' || scope === 'all') {
    effect('containers', 'position-name', '0', false, ['layout-position-name-defaulted']);
    effect('containers', 'block', 'numeric.container.child', true, ['layout-block-created', 'layout-block-rendered']);
    effect('containers', 'template', 'numeric.container.child', true, ['layout-template-selected', 'layout-template-executed']);
    for (const kind of ['container-htmlTag', 'container-htmlId']) effect('containers', kind, '0', true, ['layout-container-wrapper-rendered']);
}
console.log('Verified original numeric/anonymous names, independent template overrides and exact rendered/unrendered blocks.');
