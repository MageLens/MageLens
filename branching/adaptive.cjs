// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {validate} = require('./baseline.cjs');

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
    constructor(baseline, emit = () => {}) {
        this.emit = emit;
        this.baseline = {...validate(baseline)};
        this.observations = [];
        this.decisions = [];
        this.lifecycleCharged = false;
    }
    observe(component, ms, stage) {
        if (!['captureMs', 'restoreMs', 'releaseMs', 'resetMs', 'firstResetMs', 'backendMs'].includes(component) ||
            !Number.isFinite(ms) || ms < 0) throw new Error('Invalid checkpoint operation measurement');
        const before = this.baseline[component];
        // A slow first restore must affect the very next decision. Do not dilute
        // regressions with historical averages or lower costs on a warm sample.
        this.baseline[component] = Math.max(before, ms);
        const observation = {component, stage, ms, before, after: this.baseline[component]};
        this.observations.push(observation);
        this.emit('checkpoint-cost-observed', {node: stage, observation});
    }
    decide(stage, prefixMs, remaining, {captured = false} = {}) {
        if (!Number.isFinite(prefixMs) || prefixMs < 0 || !Number.isSafeInteger(remaining) || remaining < 0)
            throw new Error('Invalid measured prefix economics');
        const b = this.baseline;
        // Linear replay and restoration both replace the preceding test state.
        // Conservatively do not credit the reset avoided by restore. Charge the
        // additional provider startup/cleanup and first reset once per run.
        // Release is owed in both alternatives once a snapshot already exists.
        const components = {capture: captured ? 0 : b.captureMs,
            restore: remaining * b.restoreMs, release: captured ? 0 : b.releaseMs,
            lifecycle: captured || this.lifecycleCharged ? 0 : b.backendMs + b.firstResetMs};
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
