// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_nestedarguments.xml'));
assert.ok(file, 'Missing nested modifier inventory');
const fields = file.declarations.filter(item => ['argument-shared', 'argument-translate', 'argument-model', 'argument-helper', 'argument-path'].includes(item.layout.kind));
assert.equal(fields.length, 14, 'Complete nested modifier inventory');
const counts = [0, 0];
for (const item of fields) {
    const ignored = item.node.includes('/arguments[2]/');
    counts[Number(ignored)]++;
    const effects = [...new Set(item.evidence.map(event => event.type))].sort();
    if (ignored) {
        assert.equal(item.hits, 0, item.node);
        assert.equal(item.state, 'unmeasured', item.node);
        assert.deepEqual(effects, ['layout-argument-group-ignored'], item.node);
    } else {
        assert.equal(item.state, 'covered', item.node);
        assert.ok(effects.includes('layout-argument-modifier-evaluated'), item.node);
        assert.ok(effects.every(effect => ['layout-argument-modifier-evaluated', 'layout-argument-modifier-deferred'].includes(effect)), item.node);
    }
}
assert.deepEqual(counts, [9, 5]);
console.log('Verified nine evaluated nested modifiers and five explicitly ignored nested modifiers.');
