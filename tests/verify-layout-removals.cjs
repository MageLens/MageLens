// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));

const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const directory = 'app/code/MageLens/Compatibility/view/frontend/layout';
for (const [handle, element, state, effect] of [
    ['coverageprobe_layout_structure', 'magelens.layout.removed', 'covered', 'layout-removal-applied'],
    ['coverageprobe_layout_structure', 'magelens.layout.restored', 'unmeasured', 'layout-removal-canceled'],
    ['coverageprobe_layout_structure_restore', 'magelens.layout.restored', 'covered', 'layout-removal-restored']
]) {
    const source = report.files.find(file => file.path === `${directory}/${handle}.xml`);
    assert.ok(source, `Missing layout source for ${handle}`);
    const declarations = source.declarations.filter(item => item.layout?.kind === 'removal' && item.layout.element === element);
    assert.equal(declarations.length, 1, `Missing removal origin for ${handle}/${element}`);
    assert.equal(declarations[0].state, state);
    assert.deepEqual([...new Set(declarations[0].evidence.map(item => item.type))], [effect]);
}
console.log('Verified native removal, canceled removal and surviving restoration at their original attributes.');
