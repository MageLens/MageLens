// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {validate} = require('./baseline.cjs');
const samples = require('./operation-statistics.cjs');

// Select disjoint consumer groups in deterministic source order. A consumer can
// contribute avoided work to only one candidate, including nested prefixes.
function candidates(graph, specs) {
    const paths = graph.select(specs).map(spec => graph.chain(spec.parent));
    const counts = new Map();
    for (const chain of paths) for (const node of chain)
        if (node.checkpoint !== false) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    const selected = [], occupied = new Set();
    for (const chain of paths) {
        const node = [...chain].reverse().find(node => counts.get(node.id) > 1);
        if (!node || selected.includes(node.id)) continue;
        const consumers = paths.flatMap((p, i) => p.some(n => n.id === node.id) ? [i] : []);
        if (consumers.some(i => occupied.has(i))) continue;
        selected.push(node.id);
        consumers.forEach(i => occupied.add(i));
    }
    const excluded = [...counts.keys()].filter(id=>!selected.includes(id)).flatMap(id=>{
        const overlap=selected.find(chosen=>paths.some(p=>p.some(n=>n.id===id)&&p.some(n=>n.id===chosen)));
        return overlap ? [{id,reason:'overlapping-prefix',selected:overlap}] : [];
    });
    return {schemaVersion: 1, basis: 'measured-first-use', reason: 'measure-at-boundary', selected, excluded};
}

class Economics {
    constructor(baseline, emit = () => {}, statistics = {}) {
        this.emit = emit;
        this.baseline = {...validate(baseline)};
        this.statistics = samples.statistics(statistics);
        this.observations = [];
        this.decisions = [];
        this.lifecycleCharged = false;
    }
    observe(component, ms, stage) {
        if (!samples.metrics.includes(component)) throw new Error('Invalid checkpoint operation measurement');
        const before = this.baseline[component];
        const sample = samples.add(this.statistics[component], ms);
        this.statistics[component] = sample;
        const meanMs = samples.mean(sample);
        // Bootstrap estimates are not observations. Use the measured sample mean,
        // but let a newly slow operation affect the next decision immediately.
        this.baseline[component] = Math.max(meanMs, ms);
        const observation = {component, stage, ms, before, after: this.baseline[component],count:sample.count,meanMs};
        this.observations.push(observation);
        this.emit('checkpoint-cost-observed', {node: stage, observation});
    }
    decide(stage, prefixMs, remaining, {captured = false, transitionReset = false, initialReset = true} = {}) {
        if (!Number.isFinite(prefixMs) || prefixMs < 0 || !Number.isSafeInteger(remaining) || remaining < 0)
            throw new Error('Invalid measured prefix economics');
        const b = this.baseline;
        // Linear replay and restoration both replace the preceding test state.
        // Conservatively do not credit the reset avoided by restore. Charge the
        // additional provider startup/cleanup and first reset once per run.
        // A native lifecycle already establishes its fixtures and performs no
        // provider first reset; callers must exclude that absent operation.
        // Release is owed in both alternatives once a snapshot already exists.
        const components = {capture: captured ? 0 : b.captureMs,
            restore: remaining * b.restoreMs, release: captured ? 0 : b.releaseMs,
            transition: !captured && transitionReset ? b.resetMs : 0,
            lifecycle: captured || this.lifecycleCharged ? 0 : b.backendMs + (initialReset ? b.firstResetMs : 0)};
        const avoidedMs = remaining * prefixMs;
        const costMs = Object.values(components).reduce((a, v) => a + v, 0);
        const requiredMs = costMs * b.overheadMultiplier * (1 + b.overheadMargin) + b.minSavingMs;
        const decision = {stage, prefixMs, remaining, captured, components, baseline: {...b},
            avoidedMs, costMs, requiredMs, reuse: remaining > 0 && avoidedMs > requiredMs};
        this.decisions.push(decision);
        this.emit('checkpoint-decision', {node: stage, decision});
        return decision.reuse;
    }
}
module.exports = {candidates, Economics};
