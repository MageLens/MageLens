// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const source = report.files.find(file => file.path === 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_grammar_configuredurl.xml');
assert.ok(source, 'Missing configured URL layout source');
const item = '/page/body/block/arguments/argument/argument[2]/item';
for (const [suffix, effect] of [
    ['', 'layout-configured-item-evaluated'],
    ['/@name', 'layout-configured-item-name-applied'],
    ['/@xsi:type', 'layout-argument-type-evaluated'],
    ['/@path', 'layout-argument-modifier-evaluated'],
    ['/param[1]', 'layout-parameter-evaluated'],
    ['/param[1]/@name', 'layout-parameter-name-applied'],
    ['/param[2]', 'layout-parameter-evaluated'],
    ['/param[2]/@name', 'layout-parameter-name-applied'],
]) {
    const node = item + suffix;
    const declaration = source.declarations.find(row => row.node === node);
    assert.ok(declaration, `Missing configured URL operand ${node}`);
    assert.equal(declaration.state, 'covered', node);
    assert.ok(declaration.hits > 0, node);
    assert.deepEqual([...new Set(declaration.evidence.map(event => event.type))], [effect], node);
}
console.log('Verified the UI URL interpreter credits its original item, path, parameter keys and values.');
