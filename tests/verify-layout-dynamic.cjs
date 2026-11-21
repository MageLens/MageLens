// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
for (const name of ['native', 'equal', 'nested', 'scalar']) {
    const file = report.files.find(item => item.path.endsWith(`/layout/coverageprobe_dynamic_${name}.xml`));
    assert.ok(file, name);
    const item = node => {
        const declaration = file.declarations.find(entry => entry.node === node);
        assert.ok(declaration, `${name}/${node}`);
        return declaration;
    };
    const effects = declaration => [...new Set(declaration.evidence.map(event => event.type))].sort();
    const block = item('/layout/block');
    assert.ok(effects(block).includes('layout-block-created'), name);
    const template = item('/layout/block/@template');
    assert.deepEqual(effects(template), name === 'equal' ? ['layout-template-overridden']
        : ['layout-template-executed', 'layout-template-selected'], name);
    const className = item('/layout/block/@class');
    assert.deepEqual(effects(className), name === 'equal' ? ['layout-block-attribute-overridden'] : ['layout-block-class-applied'], name);
    const value = item('/layout/block/arguments/argument[1]');
    assert.equal(effects(value).includes('layout-argument-read'), name !== 'equal', name);
    if (name === 'equal') {
        assert.ok(effects(value).includes('layout-argument-overridden'), name);
        assert.equal(effects(value).includes('layout-argument-applied'), false, name);
    }
    const parent = item('/layout/block/arguments/argument[2]');
    const changed = item('/layout/block/arguments/argument[2]/item[1]');
    const surviving = item('/layout/block/arguments/argument[2]/item[2]');
    if (name === 'nested') {
        assert.ok(effects(parent).includes('layout-argument-mixed-origin'), name);
        assert.equal(effects(parent).includes('layout-argument-applied'), false, name);
        assert.ok(effects(changed).includes('layout-argument-overridden'), name);
        assert.equal(effects(changed).includes('layout-argument-read'), false, name);
        assert.ok(effects(surviving).includes('layout-argument-read'), name);
    } else if (name === 'scalar') {
        for (const replaced of [parent, changed, surviving]) {
            assert.ok(effects(replaced).includes('layout-argument-overridden'), replaced.node);
            assert.equal(effects(replaced).includes('layout-argument-applied'), false, replaced.node);
            assert.equal(effects(replaced).includes('layout-argument-read'), false, replaced.node);
        }
    } else {
        assert.ok(effects(parent).includes('layout-argument-read'), name);
        assert.ok(effects(changed).includes('layout-argument-read'), name);
        assert.ok(effects(surviving).includes('layout-argument-read'), name);
    }
}
assert.ok(report.layout.limitations.some(reason => reason.includes('programmatic XML update')),
    'Unmapped programmatic XML input lacks a provider limitation');
console.log('Verified independent original XML origins after equal-valued PHP updates, mixed arrays and scalar replacement.');
