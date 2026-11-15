// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {verifySources} = require('../../automatic.cjs');
const {digest} = require('../../identity.cjs');
const {transform} = require('./native-transform.cjs');

function prepare(manifest, selected, consumerIds) {
    verifySources(manifest);
    const tests = new Map(manifest.tests.map(test => [test.id, test]));
    const sources = new Map(manifest.sources.map(source => [source.path, source.sha256]));
    const occupied = new Set(), entries = [], candidates = [], excluded = [];
    const requested = new Set(selected ?? manifest.checkpoints.map(checkpoint => checkpoint.id));
    for (const id of requested) if (!manifest.checkpoints.some(checkpoint => checkpoint.id === id)) throw new Error('Unknown native checkpoint');
    // Keep the native test order. Prefer a deeper exact prefix, but never count
    // the same consumer's avoided work for overlapping candidates.
    for (const original of [...manifest.checkpoints].sort((a, b) => b.depth - a.depth)) {
        const checkpoint = {...original, consumers: original.consumers.filter(id => !consumerIds || consumerIds.includes(id))};
        if (!requested.has(checkpoint.id) || checkpoint.depth < 1 || checkpoint.consumers.length < 2) continue;
        if (checkpoint.consumers.some(id => occupied.has(id))) { excluded.push({id: checkpoint.id, reason: 'overlapping-prefix'}); continue; }
        const pending = [], identities = [];
        let reason;
        for (const id of checkpoint.consumers) {
            const test = tests.get(id);
            if (!test || !test.fixture.startsWith('cypress:') || test.staticallySkipped || test.steps.length <= checkpoint.depth)
                { reason = 'Native checkpoint has an invalid Cypress consumer'; break; }
            // The shared planner also inventories fixture hooks. Native Cypress
            // executes those in their original scopes for every consumer; only
            // statements inside this test callback may become a skipped prefix.
            const prefix = test.steps.slice(0, checkpoint.depth).filter(step =>
                (!step.kind || step.kind === 'statement') && step.start > test.callbackStart && step.end < test.callbackEnd);
            if (!prefix.length) { reason = 'Shared work is owned by the original hook lifecycle'; break; }
            identities.push(prefix.map(step => step.fingerprint));
            pending.push({file: path.join(manifest.root, test.file), sha256: sources.get(test.file),
                callbackStart: test.callbackStart, callbackEnd: test.callbackEnd,
                start: prefix[0].start, end: prefix.at(-1).end, checkpoint: checkpoint.id, consumer: id});
        }
        if (reason) { excluded.push({id: checkpoint.id, reason}); continue; }
        if (identities.some(identity => digest(identity) !== digest(identities[0]))) throw new Error('Native checkpoint prefix identity differs');
        try { for (const entry of pending) transform(fs.readFileSync(entry.file, 'utf8'), entry.file, [entry]); }
        catch (error) { excluded.push({id: checkpoint.id, reason: error.message}); continue; }
        entries.push(...pending);
        candidates.push({...checkpoint, identity: digest({source: manifest.sourceDigest, checkpoint})});
        checkpoint.consumers.forEach(id => occupied.add(id));
    }
    return {entries, candidates, excluded};
}
module.exports = {prepare};
