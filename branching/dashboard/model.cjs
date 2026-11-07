// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

function dashboardModel({maxCheckpointsPerTest}) {

function applyEvent(state, event) {
    if (event.schemaVersion !== 1 || !Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error('Invalid event');
    if (event.type === 'run-start') {
        if (state) throw new Error('Duplicate run start');
        if (!Array.isArray(event.nodes) || !Array.isArray(event.schedule)) throw new Error('Invalid graph');
        state = {id: event.run, startedAt: event.time, updatedAt: event.time, sequence: 0, status: 'running', phase: 'planning',
            approach: event.approach, lifetime: event.checkpointLifetime, policy: event.policy, schedule: event.schedule, warnings: event.checkpointLimit?.warnings ?? [],
            counts: {prefixExecutions: 0, reuseHits: 0, fallbacks: 0, failures: 0, blockedSpecs: 0},
            nodes: event.nodes.map(node => ({...node, status: 'waiting', active: false, operation: null,
                checkpointState: node.kind === 'checkpoint' ? 'planned' : 'none', remaining: node.consumers.length,
                executions: 0, restores: 0, elapsedMs: 0})), activity: [], cleanup: null};
        if (new Set(state.nodes.map(n => n.id)).size !== state.nodes.length) throw new Error('Duplicate graph nodes');
        const byId = new Map(state.nodes.map(n => [n.id, n]));
        for (const test of state.nodes.filter(n => n.kind === 'test')) {
            test.setup = []; test.completedStages = [];
            let parent = byId.get(test.parent);
            while (parent) {
                if (test.setup.includes(parent.id)) throw new Error('Graph cycle');
                test.setup.unshift(parent.id); parent = byId.get(parent.parent);
            }
        }
    }
    if (!state || state.id !== event.run || event.sequence !== state.sequence + 1) throw new Error('Out-of-order journal');
    const node = state.nodes.find(n => n.id === event.node);
    switch (event.type) {
        case 'run-phase': state.phase = event.phase; break;
        case 'node-start':
            if (!node) throw new Error('Unknown node');
            node.active = true; node.operation = event.operation;
            if (event.operation === 'executing') { node.status = 'running'; node.executions++; }
            if (node.kind !== 'test') {
                const test = state.nodes.find(n => n.id === state.currentSpec);
                if (test) test.activeStage = node.id;
            }
            break;
        case 'node-end':
            node.active = false; node.status = event.status; node.elapsedMs += event.ms;
            // The test body can finish before terminal-state validation. Only
            // spec-end confirms the final test outcome.
            if (node.kind === 'test' && event.status === 'passed') {
                node.active = true; node.status = 'running'; node.operation = 'validating';
            }
            if (event.operation === 'restoring' && event.status === 'passed') { node.restores++; state.counts.reuseHits++; }
            if (event.operation === 'executing' && node.kind !== 'test') state.counts.prefixExecutions++;
            if (event.status === 'passed' && node.kind !== 'test') {
                const test = state.nodes.find(n => n.id === state.currentSpec);
                if (test?.setup.includes(node.id)) {
                    const completed = event.operation === 'restoring' ? test.setup.slice(0, test.setup.indexOf(node.id) + 1) : [node.id];
                    test.completedStages = [...new Set([...test.completedStages, ...completed])];
                }
            }
            break;
        case 'checkpoint-ready':
            node.active = false; node.checkpointState = 'available'; node.checkpointId = event.checkpoint; node.elapsedMs += event.ms; break;
        case 'checkpoint-invalid':
            node.active = false; node.checkpointState = 'invalid'; state.counts.fallbacks++; break;
        case 'spec-start': state.currentSpec = event.node; node.completedStages = []; node.activeStage = null; break;
        case 'spec-end': node.active = false; node.status = event.status; node.blockedBy = event.blockedBy; break;
        case 'consumer-finished': node.remaining = event.remaining; break;
        case 'checkpoint-released': node.active = false; node.checkpointState = 'released'; node.releasedAfter = event.after; break;
        case 'run-error':
            state.counts.failures++;
            if (node) { node.active = false; node.lastError = event.phase; }
            break;
        case 'cleanup-end':
            state.cleanup = {storageReleased: event.storageReleased, retained: event.retained, failed: event.failed};
            for (const n of state.nodes) {
                n.active = false;
                if (n.checkpointState === 'available' || n.checkpointState === 'invalid') {
                    n.checkpointState = event.storageReleased ? 'released' : event.retained ? 'retained' : 'recovery-required';
                }
            }
            break;
        case 'run-end':
            state.status = event.status; state.phase = 'finished'; state.counts = event.counts; state.wallMs = event.wallMs;
            for (const n of state.nodes) { n.active = false; if (n.status === 'waiting') n.status = 'not-run'; }
            break;
    }
    state.updatedAt = event.time; state.sequence = event.sequence;
    state.activity.push({sequence: event.sequence, time: event.time, type: event.type, node: event.node ?? null,
        operation: event.operation ?? null, status: event.status ?? null, phase: event.phase ?? null});
    if (state.activity.length > 100) state.activity.shift();
    return state;
}

// A source plan is a preview. It never claims a checkpoint was selected by the
// cost planner or that any source test has executed successfully.
function manifestView(manifest) {
    if (manifest.schemaVersion !== 1 || manifest.implementation !== 'rust-prefix-v1') throw new Error('Unsupported manifest');
    const tests = new Map(manifest.tests.map(test => [test.id, test]));
    const nodes = manifest.checkpoints.map(cp => {
        const representative = tests.get(cp.representative);
        return {id: cp.id, label: cp.label ?? `Shared prefix · ${cp.depth} steps`, parent: cp.parent ?? null, kind: 'checkpoint',
            depth: 1, source: representative ? {file: representative.file, line: representative.steps?.[cp.depth - 1]?.line ?? representative.line} : null,
            consumers: cp.consumers, remaining: cp.consumers.length, lastConsumer: manifest.schedule.filter(id => cp.consumers.includes(id)).at(-1),
            releasePolicy: 'last-consumer', checkpointState: 'candidate', status: cp.automatic ? 'candidate' : 'adapter-required',
            active: false, executions: 0, restores: 0, elapsedMs: 0};
    });
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) {
        const visited = new Set([node.id]); let parent = byId.get(node.parent);
        while (parent) {
            if (visited.has(parent.id)) throw new Error('Manifest cycle');
            visited.add(parent.id); node.depth++; parent = byId.get(parent.parent);
        }
    }
    for (const id of manifest.schedule) {
        const test = tests.get(id); if (!test) throw new Error('Unknown planned test');
        const parent = manifest.checkpoints.filter(cp => cp.consumers.includes(id)).sort((a, b) => b.depth - a.depth)[0];
        nodes.push({id, label: test.title, source: {file: test.file, line: test.line}, parent: parent?.id ?? null,
            kind: 'test', status: test.disposition === 'automatic' ? 'planned' : 'adapter-required', checkpointState: 'none',
            consumers: [], remaining: 0, lastConsumer: null, active: false, executions: 0, restores: 0, elapsedMs: 0});
    }
    const warnings = manifest.tests.flatMap(test => {
        const count = manifest.checkpoints.filter(cp => cp.consumers.includes(test.id)).length;
        return count > maxCheckpointsPerTest ? [{code: 'checkpoint-limit', candidates: count, limit: maxCheckpointsPerTest, message: `${test.title}: ${count} checkpoint candidates; execution will select at most ${maxCheckpointsPerTest}. Consider splitting this long shared journey.`}] : [];
    });
    return {id: 'source-plan', status: 'planned', phase: 'planned', approach: 'Source plan', nodes, schedule: manifest.schedule, warnings,
        sourceFiles: manifest.sources.length, diagnostics: manifest.diagnostics.length, activity: [], counts: {}, sequence: 0};
}
return {applyEvent, manifestView};
}
if (typeof module !== 'undefined' && module.exports) module.exports = dashboardModel(require('../planner/src/limits.json'));
else globalThis.MageLensDashboardModel = dashboardModel;
