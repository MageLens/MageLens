// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
for (const name of ['native', 'resolver_hook', 'context_hook', 'engine_hook', 'resolver_magic',
    'context_magic', 'engine_magic', 'resolver_redeclared', 'lock_magic', 'lock_shadow']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_dependencies_${name}.xml`));
    const item = file?.declarations.find(item => item.layout.kind === 'template');
    assert.ok(item, name);
    const unknown = /^(resolver|context|engine)_(hook|magic)$/.test(name);
    assert.equal(item.state, unknown ? 'unmeasured' : 'covered', name);
    assert.equal(item.hits > 0, !unknown, name);
    const dependency = name.startsWith('engine_') ? 'engine-pool' : name.split('_')[0];
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), unknown
        ? [`layout-template-${dependency}-storage-unconfirmed`, 'layout-template-selected']
        : ['layout-template-executed', 'layout-template-selected'], name);
}
console.log('Verified template dependency ownership, magic/hooked storage, ordinary redeclaration and independent private cache storage.');
