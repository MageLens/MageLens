// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {allKinds, covered, observed} = require('./outcomes.cjs');
const layoutLimitations = require('./limitations.cjs');
const groups = [
    require('./actions.cjs'),
    require('./arguments.cjs'),
    require('./assets.cjs'),
    require('./blocks.cjs'),
    require('./conditions.cjs'),
    require('./page.cjs'),
    require('./providers.cjs'),
    require('./registries.cjs'),
    require('./structure.cjs'),
    require('./templates.cjs'),
];

const layoutEvents = Object.create(null);
const layoutDecisions = Object.create(null);
const layoutObservations = new Set();
const meanings = new Map();
const shared = [];
for (const [kinds, definitions] of groups.flat()) {
    for (const [name, outcome] of Object.entries(definitions)) {
        const effect = 'layout-' + name;
        assert.ok(!meanings.has(effect), `Duplicate layout effect: ${effect}`);
        assert.ok(outcome === covered || outcome === observed || typeof outcome === 'string' && outcome.length,
            `Unclassified layout effect: ${effect}`);
        meanings.set(effect, outcome);
        if (outcome === observed) layoutObservations.add(effect);
        if (typeof outcome === 'string') layoutDecisions[effect] = outcome;
        if (kinds === allKinds) {
            shared.push(effect);
        } else {
            for (const kind of kinds) (layoutEvents[kind] ??= []).push(effect);
        }
    }
}
for (const events of Object.values(layoutEvents)) events.push(...shared);

function countsAsLayoutCoverage(effect) {
    if (!meanings.has(effect)) throw new Error(`Unclassified layout effect: ${effect}`);
    return meanings.get(effect) === covered;
}

module.exports = {layoutEvents, layoutDecisions, layoutObservations, layoutLimitations, countsAsLayoutCoverage};
