// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
for (const name of ['native', 'template_get', 'template_set', 'template_magic', 'template_redeclared',
    'data_get', 'data_magic', 'data_set', 'data_redeclared']) {
    const source = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_propertyownership_${name}.xml`));
    assert.ok(source, name);
    const template = source.declarations.find(item => item.layout.kind === 'template');
    const opaque = ['template_get', 'template_set', 'template_magic'].includes(name);
    assert.deepEqual([...new Set(template.evidence.map(event => event.type))].sort(), name === 'data_set' ? []
        : opaque ? ['layout-template-origin-unconfirmed', 'layout-template-selected']
            : ['layout-template-executed', 'layout-template-selected'], name);
    assert.equal(template.state, name === 'data_set' ? 'uncovered' : opaque ? 'unmeasured' : 'covered', name);
    assert.equal(template.hits > 0, !opaque && name !== 'data_set', name);
    const block = source.declarations.find(item => item.layout.kind === 'block');
    assert.equal(block.state, name === 'data_set' ? 'unmeasured' : 'covered', name);
    assert.equal(block.evidence.some(event => event.type === 'layout-block-generation-failed'), name === 'data_set', name);
    const ttl = source.declarations.find(item => item.layout.kind === 'block-ttl');
    assert.deepEqual([...new Set(ttl.evidence.map(event => event.type))], name === 'data_set' ? []
        : name === 'data_get' ? ['layout-block-ttl-origin-unconfirmed'] : ['layout-block-ttl-applied'], name);
    assert.equal(ttl.hits > 0, !['data_set', 'data_get'].includes(name), name);
    for (const argument of source.declarations.filter(item => item.layout.kind === 'argument')) {
        const expected = name === 'data_get' ? ['layout-argument-application-unconfirmed', 'layout-argument-evaluated']
            : name === 'data_set' ? ['layout-argument-evaluated']
                : name === 'data_magic' ? ['layout-argument-applied', 'layout-argument-evaluated', 'layout-argument-storage-unconfirmed']
                : ['layout-argument-applied', 'layout-argument-evaluated', ...(argument.layout.element === 'nested' ? [] : ['layout-argument-read'])];
        assert.deepEqual([...new Set(argument.evidence.map(event => event.type))].sort(), expected, name + '/' + argument.layout.element);
        if (['data_get', 'data_magic'].includes(name)) {
            assert.equal(argument.state, 'covered', 'Keep independently proven evaluation/application');
            assert.match(argument.reason, name === 'data_get' ? /hooked, magic or uninitialized lazy data storage/ : /later reads lack verified XML lineage/);
            assert.ok(report.warnings.some(warning => warning.declaration === argument.id && warning.reason === argument.reason));
        }
    }
}
console.log('Verified hooked/magic storage cannot replace XML ownership with equal values; plain redeclared storage retains native evidence.');
