// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const name of ['native', 'reader', 'generator']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_argumentownership_${name}.xml`));
    assert.ok(file, name);
    for (const item of file.declarations.filter(item => item.supported)) {
        const kind = item.layout.kind;
        if (kind === 'argument-helper' && (name === 'generator' || (name === 'reader'
            && item.node.includes('/argument[3]/item[1]/')))) {
            assert.equal(item.state, 'unmeasured', `${name}/${item.node}`);
            assert.equal(item.hits, 0, `${name}/${item.node}`);
            assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(),
                item.node.includes('/action/') ? ['layout-argument-modifier-origin-unconfirmed']
                    : ['layout-argument-modifier-deferred', 'layout-argument-modifier-origin-unconfirmed']);
            continue;
        }
        if (name === 'reader' && kind === 'argument-type'
            && item.node === '/page/body/block/arguments/argument[3]/item[1]/@xsi:type') {
            assert.equal(item.state, 'unmeasured', `${name}/${item.node}`);
            assert.equal(item.hits, 0, `${name}/${item.node}`);
            assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(),
                ['layout-argument-type-deferred', 'layout-argument-type-origin-unconfirmed']);
            continue;
        }
        const argument = ['argument', 'argument-name'].includes(kind);
        const actionArgument = ['action-argument', 'action-argument-name'].includes(kind);
        const nameOperand = kind.endsWith('-name');
        const affected = argument && (name === 'reader' ? item.layout.element !== 'value'
            : name === 'generator' && item.layout.element !== 'late')
            || actionArgument && name === 'generator' && item.layout.element === 'value';
        if (affected) {
            assert.equal(item.state, 'unmeasured', `${name}/${item.node}`);
            assert.equal(item.hits, 0, `${name}/${item.node}`);
            assert.deepEqual([...new Set(item.evidence.map(event => event.type))], [nameOperand
                ? `layout-${actionArgument ? 'action-argument' : 'argument'}-name-origin-unconfirmed`
                : 'layout-argument-origin-unconfirmed']);
        } else {
            assert.equal(item.state, 'covered', `${name}/${item.node}`);
            if (argument) assert.ok(item.evidence.some(event => event.type === `layout-argument${nameOperand ? '-name' : ''}-applied`), `${name}/${item.node}`);
            if (actionArgument) assert.ok(item.evidence.some(event => event.type === `layout-action-argument${nameOperand ? '-name' : ''}-applied`), `${name}/${item.node}`);
        }
    }
}
const unvisited = report.files.find(file => file.path.endsWith('/layout/coverageprobe_interpreter_index.xml'));
assert.ok(unvisited, 'Unvisited native interpreter fixture');
for (const item of unvisited.declarations) {
    assert.equal(item.hits, 0, item.node);
    assert.deepEqual(item.evidence, [], item.node);
    if (item.supported) assert.equal(item.state, 'uncovered', item.node);
}
console.log('Verified native reader/generator argument ownership, equal replacements, nested tree limits and independent action-call and parameter origins.');
