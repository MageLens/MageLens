// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const types = new Set(['ui-constructed', 'ui-rendered', 'ui-action-invoked', 'ui-reloaded']);

function loadUiBrowserScope(run) {
    if (!run || !fs.existsSync('coverage/xml-manifest.json')) return {};
    const manifest = JSON.parse(fs.readFileSync('coverage/xml-manifest.json', 'utf8'));
    assert.equal(manifest.run, run, 'Stale XML browser source inventory');
    const scope = new Map();
    for (const file of manifest.files) for (const item of file.declarations) {
        if (item.family !== 'ui-component' || !item.supported) continue;
        const effects = item.effects.filter(type => types.has(type));
        if (effects.length) scope.set(item.path, [...new Set([...(scope.get(item.path) ?? []), ...effects])]);
    }
    return Object.fromEntries(scope);
}

module.exports = {loadUiBrowserScope};
