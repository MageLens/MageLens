// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
for (const name of ['first', 'second']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_shared_${name}.xml`));
    assert.ok(file, name);
    const effects = node => {
        const declaration = file.declarations.find(item => item.node === node);
        assert.ok(declaration, `${name}/${node}`);
        return [...new Set(declaration.evidence.map(event => event.type))].sort();
    };
    assert.deepEqual(effects('/layout/block'), ['layout-block-created', 'layout-block-render-origin-unconfirmed',
        'layout-block-rendered'], name);
    assert.deepEqual(effects('/layout/block/@template'), name === 'first'
        ? ['layout-template-replaced', 'layout-template-selected']
        : ['layout-template-executed', 'layout-template-selected'], name);
    assert.ok(!effects('/layout/block/@class').includes('layout-block-class-applied'),
        'A custom factory cannot establish native class construction');
}
assert.ok(report.layout.limitations.some(reason => reason.includes('shared block object')));
console.log('Verified separate layout element render origins and ambiguous direct calls on a shared block object.');
