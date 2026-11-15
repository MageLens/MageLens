// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Proposed observation contract, not benchmark evidence. Explicit numbers make
// presentation/accounting assertions independent of host scheduling and clocks.
const baseline = {...require('../../../branching/baseline.cjs').defaults,
    captureMs: 100, restoreMs: 100, releaseMs: 10, resetMs: 20, firstResetMs: 20, backendMs: 30};
const schedule = ['setup', 'a', 'b', 'c', 'serial'];
const nodes = [
    {id: 'prefix', label: 'Catalog prefix', kind: 'checkpoint', parent: null, depth: 1,
        consumers: ['a', 'b', 'c'], lastConsumer: 'c', releasePolicy: 'last-consumer'},
    ...schedule.map(id => ({id, label: id, kind: 'test', parent: ['a', 'b', 'c'].includes(id) ? 'prefix' : null,
        consumers: [], releasePolicy: 'none'}))
];
function decision({prefixMs = 1000, remaining = 2, captured = false, restoreMs = 100} = {}) {
    const components = {capture: captured ? 0 : 100, restore: remaining * restoreMs,
        release: captured ? 0 : 10, lifecycle: captured ? 0 : 50};
    const costMs = Object.values(components).reduce((a, b) => a + b, 0);
    const requiredMs = costMs * baseline.overheadMultiplier * (1 + baseline.overheadMargin) + baseline.minSavingMs;
    return {stage: 'prefix', prefixMs, remaining, captured, components, baseline: {...baseline, restoreMs},
        avoidedMs: remaining * prefixMs, costMs, requiredMs, reuse: remaining * prefixMs > requiredMs};
}
function journey(kind = 'abandoned', run = require('node:crypto').randomUUID()) {
    const events = [];
    const add = (type, data = {}) => events.push({schemaVersion: 1, run, sequence: events.length + 1,
        time: 1700000000000 + events.length, type, ...structuredClone(data)});
    add('run-start', {approach: 'branching', checkpointLifetime: 'last-consumer',
        policy: {basis: 'measured-first-use'}, nodes: [], schedule: []});
    add('run-phase', {phase: 'discovering'});
    add('discovery-complete', {nodes, schedule,
        ordering: {original: schedule, execution: schedule, changed: false},
        excludedCandidates: [{id: 'ancestor', reason: 'overlapping-prefix', selected: 'prefix'}]});
    if (kind === 'discovered') return events;
    if (kind === 'bootstrap') {
        add('checkpoint-baseline', {status: 'estimated', reason: 'incompatible-measurements-ignored', baseline});
        add('run-phase', {phase: 'preparing'});
        return events;
    }
    add('checkpoint-baseline', {status: 'estimated', baseline});
    add('run-ready');
    add('spec-start', {node: 'setup'});
    add('spec-end', {node: 'setup', status: 'passed'});
    add('spec-start', {node: 'a'});
    add('node-start', {node: 'prefix', operation: 'executing'});
    if (kind === 'measuring') return events;
    add('node-end', {node: 'prefix', operation: 'executing', status: 'passed', ms: kind === 'linear' ? 1 : 1000});
    add('checkpoint-decision', {node: 'prefix', decision: decision({prefixMs: kind === 'linear' ? 1 : 1000})});
    if (kind === 'linear') return events;
    add('node-start', {node: 'prefix', operation: 'capturing'});
    if (kind === 'capturing') return events;
    add('checkpoint-ready', {node: 'prefix', checkpoint: 'owned-snapshot', ms: 100});
    add('consumer-finished', {node: 'prefix', remaining: 2});
    add('spec-end', {node: 'a', status: 'passed'});
    add('spec-start', {node: 'b'});
    add('node-start', {node: 'prefix', operation: 'restoring'});
    if (kind === 'restoring') return events;
    if (kind === 'failed') {
        add('run-error', {node: 'prefix', phase: 'restore'});
        add('checkpoint-invalid', {node: 'prefix', operation: 'restoring'});
        add('cleanup-end', {storageReleased: true, retained: false, failed: false});
        add('run-end', {status: 'failed', wallMs: 2500, counts: {reuseHits: 0, failures: 1, fallbacks: 1}});
        return events;
    }
    add('node-end', {node: 'prefix', operation: 'restoring', status: 'passed', ms: 1500});
    add('checkpoint-cost-observed', {node: 'prefix', observation: {stage: 'prefix', component: 'restoreMs',
        ms: 1500, before: 100, after: 1500, count:1, meanMs:1500}});
    add('consumer-finished', {node: 'prefix', remaining: 1});
    add('spec-end', {node: 'b', status: 'passed'});
    add('checkpoint-decision', {node: 'prefix', decision: decision({remaining: 1, captured: true, restoreMs: 1500})});
    if (kind === 'abandoning') return events;
    add('checkpoint-released', {node: 'prefix', after: 'b', reason: 'uneconomic', ms: 10});
    add('checkpoint-reuse-abandoned', {node: 'prefix', remaining: 1, resetVerified: true});
    if (kind !== 'finished') return events;
    for (const id of ['c', 'serial']) {
        add('spec-start', {node: id});
        add('spec-end', {node: id, status: 'passed'});
        if (id === 'c') add('consumer-finished', {node: 'prefix', remaining: 0});
    }
    add('cleanup-end', {storageReleased: true, retained: false, failed: false});
    add('run-end', {status: 'passed', wallMs: 4000, counts: {reuseHits: 1, failures: 0, fallbacks: 0}});
    return events;
}
// Seed already-discovered nodes for focused lifecycle tests. Keep discovery
// tests separate so a missing graph update cannot mask every later UI defect.
function withDiscoveredGraph(events) {
    const discovery = events.find(e => e.type === 'discovery-complete');
    return events.filter(e => e.type !== 'discovery-complete').map((e, i) => ({
        ...e, sequence: i + 1, ...(i === 0 ? {nodes: discovery.nodes, schedule: discovery.schedule} : {})
    }));
}
module.exports = {baseline, nodes, schedule, decision, journey, withDiscoveredGraph};
