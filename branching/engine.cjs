// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {events, describeGraph} = require('./events.cjs');
const {limitCheckpoints} = require('./checkpoint-limit.cjs');

function canonical(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    }
    throw new Error('Identity values must be finite JSON data');
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
function fileDigest(file) {
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), fd = fs.openSync(file, 'r');
    try { let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size)); }
    finally { fs.closeSync(fd); }
    return hash.digest('hex');
}
function sync(file) { const fd = fs.openSync(file, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function write(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    sync(file);
}
function inventory(directory, relative = '') {
    return fs.readdirSync(path.join(directory, relative)).sort().flatMap(name => {
        const key = path.join(relative, name), file = path.join(directory, key), stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) throw new Error('Checkpoint symlinks are unsupported');
        if (stat.isDirectory()) return inventory(directory, key);
        if (!stat.isFile()) throw new Error('Checkpoint must contain regular files');
        return [{path: key, bytes: stat.size, allocatedBytes: stat.blocks * 512, sha256: fileDigest(file)}];
    });
}
function allocatedBytes(directory) {
    return fs.readdirSync(directory).reduce((total, name) => {
        const file = path.join(directory, name), stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Unexpected checkpoint file type');
        return total + (stat.isDirectory() ? allocatedBytes(file) : stat.blocks * 512);
    }, 0);
}

class Graph {
    constructor({stages, specs, identity}) {
        if (!Array.isArray(stages) || !stages.length || !Array.isArray(specs) || !specs.length) throw new Error('Empty workflow');
        this.identity = JSON.parse(canonical(identity));
        for (const field of ['source', 'fixture', 'configuration', 'dependencies', 'implementation']) {
            if (!identity[field]) throw new Error(`Missing ${field} identity`);
        }
        this.stages = new Map(); this.specs = new Map(); this.keys = new Map();
        const ids = new Set();
        for (const [nodes, target, kind] of [[stages, this.stages, 'Stage'], [specs, this.specs, 'Spec']]) {
            for (const node of nodes) {
                if (!/^[a-z][a-z0-9-]{0,79}$/.test(node.id) || ids.has(node.id)) throw new Error('Invalid or duplicate node ID');
                if (typeof node.run !== 'function' || typeof node.assert !== 'function') throw new Error(`${kind} needs execution and assertions`);
                if (node.checkpoint !== undefined && typeof node.checkpoint !== 'boolean') throw new Error('checkpoint must be boolean');
                if (kind === 'Spec' && typeof node.parent !== 'string') throw new Error('Spec must depend on exactly one Stage');
                if (node.parent !== undefined && node.parent !== null && typeof node.parent !== 'string') throw new Error('Only one Stage parent is supported');
                ids.add(node.id); target.set(node.id, {...node, inputs: JSON.parse(canonical(node.inputs ?? {}))});
            }
        }
        for (const node of [...this.stages.values(), ...this.specs.values()]) {
            if (node.parent != null && !this.stages.has(node.parent)) throw new Error(`Missing Stage ${node.parent}`);
        }
        for (const id of this.stages.keys()) this.key(id, new Set());
    }
    key(id, visiting = new Set()) {
        if (this.keys.has(id)) return this.keys.get(id);
        if (visiting.has(id)) throw new Error('Stage cycle');
        visiting.add(id);
        const node = this.stages.get(id);
        const key = digest({identity: this.identity, id, inputs: node.inputs, parent: node.parent ? this.key(node.parent, visiting) : null,
            run: node.run.toString(), assert: node.assert.toString(), checkpoint: node.checkpoint ?? true, boundary: node.boundary ?? 'quiescent-v1'});
        visiting.delete(id); this.keys.set(id, key); return key;
    }
    chain(id) {
        const result = []; let node = this.stages.get(id);
        while (node) { result.unshift(node); node = this.stages.get(node.parent); }
        return result;
    }
    select(ids = [...this.specs.keys()]) {
        if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Empty or duplicate Spec selection');
        return ids.map(id => { if (!this.specs.has(id)) throw new Error(`Unknown Spec ${id}`); return this.specs.get(id); });
    }
}

class CheckpointStore {
    constructor(root, owner, profile) { this.root = root; this.owner = owner; this.profile = profile; this.available = new Map(); }
    verify(ref, key, now = Date.now()) {
        const manifest = JSON.parse(fs.readFileSync(path.join(ref.directory, 'manifest.json'), 'utf8'));
        if (manifest.schemaVersion !== 1 || digest(manifest) !== ref.digest || manifest.status !== 'available' || manifest.owner !== this.owner ||
            manifest.key !== key || manifest.profile !== this.profile || manifest.expiresAt <= now) throw new Error('Incomplete, expired or incompatible checkpoint');
        const actual = inventory(path.join(ref.directory, 'payload'));
        // Allocated blocks can change independently of content on CoW filesystems.
        const content = entries => entries.map(({allocatedBytes, ...entry}) => entry);
        if (canonical(content(actual)) !== canonical(content(manifest.artifacts))) throw new Error('Corrupted checkpoint');
        return manifest;
    }
    release(stage) {
        const ref = this.available.get(stage);
        if (!ref) return null;
        if (path.dirname(ref.directory) !== this.root || fs.lstatSync(ref.directory).isSymbolicLink()) throw new Error('Unowned checkpoint directory');
        const manifest = JSON.parse(fs.readFileSync(path.join(ref.directory, 'manifest.json'), 'utf8'));
        if (manifest.owner !== this.owner || manifest.id !== ref.id || digest(manifest) !== ref.digest) throw new Error('Unowned checkpoint');
        fs.rmSync(ref.directory, {recursive: true});
        this.available.delete(stage);
        return ref.id;
    }
    async capture({key, stage, parent, lineage, ttlMs, provider, measured, assert, fault}) {
        const id = randomUUID(), pending = path.join(this.root, id + '.pending'), directory = path.join(this.root, id);
        fs.mkdirSync(pending, {mode: 0o700}); fs.mkdirSync(path.join(pending, 'payload'), {mode: 0o700});
        write(path.join(pending, 'operation.json'), {owner: this.owner, id, stage, status: 'capturing'});
        await measured('barrier', () => provider.captureBarrier ? provider.captureBarrier() : provider.barrier());
        const expected = await provider.normalizedState();
        await measured('capture', () => provider.capture(path.join(pending, 'payload')));
        await fault?.('captured', {directory: pending});
        const artifacts = await measured('hashingDurability', async () => {
            const entries = inventory(path.join(pending, 'payload'));
            if (!entries.length) throw new Error('Empty checkpoint');
            for (const entry of entries) sync(path.join(pending, 'payload', entry.path));
            sync(path.join(pending, 'payload')); return entries;
        });
        const deferred = typeof provider.resumeCapture === 'function';
        await measured(deferred ? 'resumeOriginal' : 'validation', async () => {
            if (deferred) await provider.resumeCapture();
            else await provider.restore(path.join(pending, 'payload'));
            await assert(provider);
            if (canonical(await provider.normalizedState()) !== canonical(expected)) throw new Error('Restored state differs from captured state');
        });
        await fault?.('validated', {directory: pending});
        const manifest = {schemaVersion: 1, id, owner: this.owner, profile: this.profile, key, stage,
            parent, lineage, status: 'available', artifacts,
            ...(deferred ? {restoreValidation: 'first-reuse', expectedStateDigest: digest(expected)} : {}), createdAt: Date.now(), expiresAt: Date.now() + ttlMs};
        const ref = {id, directory, digest: digest(manifest)};
        await measured('publication', async () => {
            write(path.join(pending, 'manifest.json'), manifest); sync(pending);
            fs.renameSync(pending, directory); sync(this.root);
        });
        this.available.set(stage, ref); return ref;
    }
}

class ParentFailure extends Error { constructor(stage, message) { super(message); this.stage = stage; } }

async function execute({workflow, provider, approach = 'P0', specs, root, ttlMs = 3600000, fault, retain = false, checkpointLifetime = 'run', checkpointSelection, checkpointPolicy, eventDirectory = process.env.MAGELENS_BRANCHING_EVENTS, onEvent}) {
    const graph = workflow instanceof Graph ? workflow : new Graph(workflow), selected = graph.select(specs);
    if (!['L0', 'P0'].includes(approach)) throw new Error('Unknown execution approach');
    if (!provider.approaches.includes(approach)) throw new Error(`Provider does not implement ${approach}`);
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('Invalid checkpoint TTL');
    if (!['run', 'last-consumer'].includes(checkpointLifetime)) throw new Error('Invalid checkpoint lifetime');
    if (checkpointSelection !== undefined && !Array.isArray(checkpointSelection)) throw new Error('Invalid checkpoint selection');
    const requested = checkpointSelection === undefined ? null : new Set(checkpointSelection);
    if (requested && (requested.size !== checkpointSelection.length || [...requested].some(id=>!graph.stages.has(id) || graph.stages.get(id).checkpoint === false))) throw new Error('Invalid checkpoint selection');
    const limited = limitCheckpoints(graph, selected, {requested, approach, checkpointLifetime}), chosen = limited.chosen;
    const remaining = new Map();
    for (const spec of selected) for (const node of graph.chain(spec.parent)) remaining.set(node.id, (remaining.get(node.id) ?? 0) + 1);
    const start = performance.now(), cpu = process.cpuUsage(), run = randomUUID();
    fs.mkdirSync(root, {recursive: true, mode: 0o700});
    const directory = fs.mkdtempSync(path.join(root, 'run-'));
    write(path.join(directory, 'owner.json'), {schemaVersion: 1, kind: 'magelens-branching', run});
    const report = {schemaVersion: 1, run, approach, workload: provider.workload, capability: provider.capability,
        identity: graph.identity, runtime: provider.identity, workloadCounts: provider.actionCounts ?? null,
        directory, status: 'running', phases: {}, segments: [], results: [], checkpoints: [], releases: [], checkpointLifetime, checkpointPolicy: checkpointPolicy ?? null, checkpointLimit: limited.report,
        counts: {prefixExecutions: 0, reuseHits: 0, fallbacks: 0, failures: 0, blockedSpecs: 0}, errors: [],
        costs: {schemaVersion: 1, resets: [], captures: [], restores: [], releases: []},
        coverage: provider.coverageKind ?? 'unsupported', metrics: {peakPhysicalBytes: null, diskReadBytes: null, diskWriteBytes: null}};
    const observer = events({run, directory: eventDirectory, onEvent});
    report.observation = observer.diagnostics;
    const emit = (type, data = {}) => observer.emit(type, data);
    if (observer.diagnostics.enabled) emit('run-start', {approach, checkpointLifetime, retain, schedule: selected.map(spec => spec.id),
        nodes: describeGraph(graph, selected, {approach, checkpointLifetime, retain, chosen}),
        policy: checkpointPolicy ? {reason: checkpointPolicy.reason, selected: checkpointPolicy.selected} : null, checkpointLimit: limited.report});
    const measured = async (phase, fn) => { const time = performance.now(); try { return await fn(); }
        finally { report.phases[phase] = (report.phases[phase] ?? 0) + performance.now() - time; } };
    const store = new CheckpointStore(directory, run, digest({identity: graph.identity, provider: provider.identity}));
    const failed = new Map(), disabled = new Set();
    const errorRecord = (phase, error, stage = null) => {
        report.errors.push({phase, stage, message: error.message}); report.counts.failures++;
        emit('run-error', {phase, node: stage});
    };
    const segment = async (node, kind) => {
        const entry = {id: randomUUID(), node: node.id, kind, status: 'running', observed: true,
            variant: 'recipe'};
        report.segments.push(entry); if (kind === 'Stage') report.counts.prefixExecutions++;
        const time = performance.now();
        emit('node-start', {node: node.id, operation: 'executing'});
        try {
            await provider.beginSegment?.(entry.id);
            await node.run(provider, node.inputs);
            await node.assert(provider, node.inputs);
            entry.coverage = await provider.endSegment?.(entry.id) ?? null;
            entry.status = 'passed';
        } catch (error) {
            entry.status = 'failed'; entry.error = error.message;
            if (kind === 'Stage') {
                failed.set(node.id, error.message); errorRecord('stage', error, node.id);
                throw new ParentFailure(node.id, error.message);
            }
            throw error;
        } finally {
            entry.wallMs = performance.now() - time; entry.actions = provider.segmentMetrics?.() ?? null;
            emit('node-end', {node: node.id, operation: 'executing', status: entry.status, ms: entry.wallMs});
        }
        return entry.id;
    };
    const reuse = approach === 'P0';
    async function resolve(id) {
        const node = graph.stages.get(id);
        for (const ancestor of graph.chain(id)) if (failed.has(ancestor.id)) throw new ParentFailure(ancestor.id, failed.get(ancestor.id));
        const ref = reuse && store.available.get(id);
        if (ref) {
            const restoreStart = performance.now();
            emit('node-start', {node: id, operation: 'restoring'});
            try {
                const manifest = await measured('reuseValidation', async () => store.verify(ref, graph.key(id)));
                await fault?.('beforeRestore', {ref, stage: id});
                // Recheck after external delays/fault hooks, before consuming any bytes.
                store.verify(ref, graph.key(id));
                await measured('restore', () => provider.restore(path.join(ref.directory, 'payload')));
                await measured('readiness', () => node.assert(provider, node.inputs));
                if (manifest.restoreValidation === 'first-reuse' && !ref.restoreValidated) {
                    await measured('firstReuseValidation', async () => {
                        if (digest(await provider.normalizedState()) !== manifest.expectedStateDigest) {
                            throw new Error('Restored state differs from captured state on first reuse');
                        }
                    });
                    ref.restoreValidated = true;
                    report.counts.firstReuseValidations = (report.counts.firstReuseValidations ?? 0) + 1;
                }
                report.counts.reuseHits++;
                report.costs.restores.push({stage: id, ms: performance.now() - restoreStart});
                emit('node-end', {node: id, operation: 'restoring', status: 'passed', ms: performance.now() - restoreStart});
                return {parent: ref.id, lineage: [...manifest.lineage]};
            } catch (error) {
                errorRecord('restore', error, id); report.counts.fallbacks++;
                store.available.delete(id); disabled.add(id);
                emit('checkpoint-invalid', {node: id, operation: 'restoring'});
            }
        }
        const prior = node.parent ? await resolve(node.parent) : await measured('reset', async () => {
            const time = performance.now(); await provider.reset();
            report.costs.resets.push(performance.now() - time); return {parent: null, lineage: []};
        });
        prior.lineage.push(await measured('prefix', () => segment(node, 'Stage')));
        if (reuse && node.checkpoint !== false && (!chosen || chosen.has(id)) && !disabled.has(id) && (checkpointLifetime === 'run' || remaining.get(id) > 1)) {
            try {
                const time = performance.now();
                emit('node-start', {node: id, operation: 'capturing'});
                const ref = await store.capture({key: graph.key(id), stage: id, parent: prior.parent, lineage: [...prior.lineage],
                    ttlMs, provider, measured, assert: runtime => node.assert(runtime, node.inputs), fault});
                const manifest = store.verify(ref, graph.key(id));
                report.costs.captures.push({stage: id, ms: performance.now() - time});
                report.checkpoints.push(manifest); prior.parent = ref.id;
                emit('checkpoint-ready', {node: id, checkpoint: ref.id, ms: performance.now() - time});
            } catch (error) {
                errorRecord('capture', error, id); report.counts.fallbacks++; disabled.add(id); store.available.delete(id);
                emit('checkpoint-invalid', {node: id, operation: 'capturing'});
                // A failed validation may have partially mutated the runtime. Replay
                // from a verified ancestor, never continue from that partial restore.
                return resolve(id);
            }
        }
        return prior;
    }
    try {
        emit('run-phase', {phase: 'preparing'});
        await measured('prepare', () => provider.prepare({run, directory, approach}));
        emit('run-phase', {phase: 'running'});
        for (const [index, spec] of selected.entries()) {
            const result = {spec: spec.id, status: 'running', inheritedSegments: [], observedSegments: []};
            const first = report.segments.length;
            emit('spec-start', {node: spec.id, index});
            try {
                if (provider.beforeSpec) await measured('specPreparation', () => provider.beforeSpec({
                    id: spec.id, parent: spec.parent, index,
                    next: selected[index + 1]?.id ?? null, nextParent: selected[index + 1]?.parent ?? null
                }));
                const state = await resolve(spec.parent);
                result.parentCheckpoint = state.parent;
                result.lineage = [...state.lineage, await measured('suffix', () => segment(spec, 'Spec'))];
                const observed = new Set(report.segments.slice(first).map(item => item.id));
                result.inheritedSegments = result.lineage.filter(id => !observed.has(id));
                result.observedSegments = result.lineage.filter(id => observed.has(id));
                result.state = await measured('terminalState', () => provider.normalizedState());
                result.status = 'passed';
            } catch (error) {
                result.status = error instanceof ParentFailure ? 'blocked' : 'failed';
                result.blockedBy = error.stage ?? null; result.error = error.message;
                if (error instanceof ParentFailure) report.counts.blockedSpecs++;
                else errorRecord('scenario', error, error.stage);
            }
            report.results.push(result);
            emit('spec-end', {node: spec.id, status: result.status, blockedBy: result.blockedBy ?? null});
            for (const node of graph.chain(spec.parent).reverse()) {
                remaining.set(node.id, remaining.get(node.id) - 1);
                emit('consumer-finished', {node: node.id, spec: spec.id, remaining: remaining.get(node.id)});
                if (checkpointLifetime === 'last-consumer' && !retain && remaining.get(node.id) === 0) {
                    try {
                        const time = performance.now();
                        if (store.available.has(node.id)) emit('node-start', {node: node.id, operation: 'releasing'});
                        const checkpoint = await measured('checkpointRelease', async () => store.release(node.id));
                        if (checkpoint) {
                            report.releases.push({stage: node.id, checkpoint, after: spec.id});
                            report.costs.releases.push({stage: node.id, ms: performance.now() - time});
                            emit('checkpoint-released', {node: node.id, after: spec.id});
                        }
                    } catch (error) { errorRecord('checkpointRelease', error, node.id); }
                }
            }
        }
    } catch (error) { errorRecord('prepare', error); }
    finally {
        emit('run-phase', {phase: 'cleaning'});
        try { await measured('cleanup', () => provider.cleanup()); }
        catch (error) { errorRecord('cleanup', error); }
        try {
            await measured('storageAccounting', async () => {
                if (provider.measureStorage) {
                    report.storageAccounting = await provider.measureStorage(directory);
                    report.metrics.snapshotAllocatedBytes = report.storageAccounting.snapshotAllocatedBytes;
                } else {
                    report.storageAccounting = {sumFileAllocatedBytes: allocatedBytes(directory),
                        method: 'Sum of allocated blocks for all run files; shared CoW blocks may be counted repeatedly. Not physical or exclusive usage.'};
                    report.metrics.snapshotAllocatedBytes = null;
                }
            });
        }
        catch (error) { report.metrics.snapshotAllocatedBytes = null; errorRecord('accounting', error); }
        // Preserve evidence and recovery data if the runtime could not be cleaned up.
        if (!retain && !report.errors.some(error => error.phase === 'cleanup')) {
            try { await measured('cleanup', async () => cleanup(directory, run)); }
            catch (error) { errorRecord('cleanup', error); }
        }
    }
    emit('cleanup-end', {storageReleased: !fs.existsSync(directory), retained: retain,
        failed: report.errors.some(error => error.phase === 'cleanup')});
    report.status = report.results.length === selected.length && report.results.every(result => result.status === 'passed') &&
        report.errors.length === 0 ? 'passed' : 'failed';
    report.qualification = report.status === 'passed' && report.errors.length === 0 ?
        (provider.workload === 'contract-fixture' ? 'contract-only' : 'scenario-only') : 'inconclusive';
    report.metrics.wallMs = performance.now() - start;
    const used = process.cpuUsage(cpu); report.metrics.orchestratorCpuMs = (used.user + used.system) / 1000;
    report.metrics.totalCpuMs = null; // Service/browser CPU needs external cgroup accounting.
    report.providerPhases = provider.timings ?? {};
    if (provider.diagnostics) report.providerDiagnostics = provider.diagnostics;
    emit('run-end', {status: report.status, counts: report.counts, wallMs: report.metrics.wallMs});
    await observer.close();
    // Include final asynchronous journal drainage in measured execution cost.
    report.metrics.wallMs = performance.now() - start;
    const finalCpu = process.cpuUsage(cpu); report.metrics.orchestratorCpuMs = (finalCpu.user + finalCpu.system) / 1000;
    return report;
}
function cleanup(directory, run) {
    if (fs.lstatSync(directory).isSymbolicLink() || !/^run-/.test(path.basename(directory))) throw new Error('Unowned run directory');
    const owner = JSON.parse(fs.readFileSync(path.join(directory, 'owner.json')));
    if (owner.kind !== 'magelens-branching' || owner.run !== run) throw new Error('Unowned run directory');
    fs.rmSync(directory, {recursive: true});
}
module.exports = {Graph, CheckpointStore, execute, cleanup, digest, canonical, fileDigest, inventory};
