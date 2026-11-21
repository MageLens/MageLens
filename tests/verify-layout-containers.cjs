// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const directory = 'app/code/MageLens/Compatibility/view/frontend/layout';

for (const [handle, name, attribute, state, effects] of [
    ['structure', 'left', null, 'covered', ['layout-container-created']],
    ['structure', 'left', 'htmlTag', 'covered', ['layout-container-wrapper-rendered']],
    ['structure', 'left', 'htmlId', 'covered', ['layout-container-wrapper-rendered']],
    ['structure', 'left', 'htmlClass', 'unmeasured', ['layout-container-attribute-overridden']],
    ['structure_restore', 'left', 'htmlClass', 'covered', ['layout-container-wrapper-rendered']],
    ['structure', 'empty', null, 'covered', ['layout-container-created']],
    ['structure', 'empty', 'htmlTag', 'uncovered', []],
    ['structure', 'hidden-container', null, 'covered', ['layout-container-created']],
    ['structure', 'hidden-container', 'htmlTag', 'uncovered', []],
    ['structure', 'hidden-container', 'display', 'covered', ['layout-display-denied']],
    ['structure', 'hidden', 'display', 'covered', ['layout-display-denied']],
    ['structure', 'removed', null, 'uncovered', []],
]) {
    const file = report.files.find(file => file.path === `${directory}/coverageprobe_layout_${handle}.xml`);
    const items = file?.declarations.filter(item => item.layout?.element === `magelens.layout.${name}`
        && item.layout.attribute === attribute && (attribute !== null || item.layout.instruction === 'container'));
    assert.equal(items?.length, 1, `${handle}/${name}/${attribute}`);
    const [item] = items;
    assert.equal(item.state, state, `${handle}/${name}/${attribute}`);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), effects);
}
console.log('Verified container creation, effective wrappers, empty and removed containers and display suppression.');
