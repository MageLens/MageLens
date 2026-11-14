// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const SEGMENT_TIMING_BOUNDARY = 'checkpoint-segment-run-duration/v1';
const protocol = require('./configs/protocol.cjs');

const messages = require('./configs/messages.cjs');

const config = require('./configs/runtime.cjs');

const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {digest} = require('./identity.cjs');
class ParentFailure extends Error {
    constructor(stage, message) {
        super(message);
        this.stage = stage;
    }
}

function createExecution({
    graph,
    selected,
    provider,
    approach,
    store,
    report,
    emit,
    measured,
    errorRecord,
    chosen,
    checkpointLifetime,
    retain,
    ttlMs,
    fault,
    adaptive = false
}) {
    const economics = adaptive ? new (require('./adaptive.cjs').Economics)(graph.costBaseline) : null;
    const prefixDurations = new Map();
    if (economics) report.adaptive = {baselineBefore: {...economics.baseline},
        observations: economics.observations, decisions: economics.decisions, baselineAfter: economics.baseline};
    const remaining = new Map();
    for (const spec of selected) {
        for (const node of graph.chain(spec.parent)) {
            remaining.set(node.id, (remaining.get(node.id) ?? 0) + 1);
        }
    }
    const failed = new Map(),
        disabled = new Set();
    const segment = async (node, kind) => {
        const entry = {
            id: randomUUID(),
            node: node.id,
            kind,
            status: protocol.status.running,
            observed: true,
            variant: 'recipe'
        };
        if (kind === 'Stage' && Number.isInteger(node.inputs?.fromDepth) &&
            Number.isInteger(node.inputs.checkpoint?.depth)) {
            entry.prefixTiming = {
                timingBoundary:SEGMENT_TIMING_BOUNDARY,
                kind:node.inputs.checkpoint.depth === 0 ? 'fixture' : 'steps',
                fromDepth:node.inputs.fromDepth,
                toDepth:node.inputs.checkpoint.depth,
                workMs:null,
                workCompleted:false
            };
        }
        report.segments.push(entry);
        if (kind === 'Stage') report.counts.prefixExecutions++;
        const time = performance.now();
        emit(protocol.event.nodeStart, {node: node.id, operation: protocol.operation.execute});
        try {
            await provider.beginSegment?.(entry.id);
            const workStarted = performance.now();
            try {
                await node.run(provider, node.inputs);
                if (entry.prefixTiming) entry.prefixTiming.workCompleted = true;
            } finally {
                if (entry.prefixTiming) entry.prefixTiming.workMs = performance.now()-workStarted;
            }
            if (!(adaptive && graph.nativePageLifecycle && kind === 'Stage')) {
                entry.coverage = (await provider.endSegment?.(entry.id, {terminal:kind === 'Spec'})) ?? null;
                await node.assert(provider, node.inputs);
            }
            entry.status = protocol.status.passed;
        } catch (error) {
            entry.status = protocol.status.failed;
            entry.error = error.message;
            if (kind === 'Stage') {
                failed.set(node.id, error.message);
                errorRecord('stage', error, node.id);
                throw new ParentFailure(node.id, error.message);
            }
            throw error;
        } finally {
            entry.wallMs = performance.now() - time;
            if (kind === 'Stage' && entry.status === protocol.status.passed && !prefixDurations.has(node.id))
                prefixDurations.set(node.id, entry.prefixTiming?.workMs ?? entry.wallMs);
            emit(protocol.event.nodeEnd, {
                node: node.id,
                operation: protocol.operation.execute,
                status: entry.status,
                ms: entry.wallMs
            });
        }
        return entry.id;
    };
    function invalidate(id, phase, operation, error) {
        errorRecord(phase, error, id);
        report.counts.fallbacks++;
        disabled.add(id);
        store.available.delete(id);
        emit(protocol.event.checkpointInvalid, {node: id, operation});
    }

    const reuse = approach === config.APPROACH.branching;
    function nextPrefetch(next) {
        if (economics || !next || !provider.prefetch || graph.chain(next.parent).some(node => failed.has(node.id))) return null;
        for (const node of graph.chain(next.parent).reverse()) {
            const ref = reuse && store.available.get(node.id);
            if (!ref) continue;
            try { store.verify(ref, graph.key(node.id)); }
            catch { continue; } // Normal restore owns invalidation/fallback.
            return {directory: path.join(ref.directory, config.files.payload), next: next.id};
        }
        return {directory: null, next: next.id};
    }
    async function restoreCheckpoint(node, ref, next) {
        const id = node.id;
        const restoreStart = performance.now();
        emit(protocol.event.nodeStart, {node: id, operation: protocol.operation.restore});
        try {
            const manifest = await measured('reuseValidation', async () => store.verify(ref, graph.key(id)));
            await fault?.('beforeRestore', {ref, stage: id});
            // Recheck after external delays/fault hooks, before consuming any bytes.
            store.verify(ref, graph.key(id));
            // Only published snapshots for an actual next consumer may be prepared
            // while the current browser is being reconstructed.
            const prefetch = nextPrefetch(next);
            await measured('restore', () => provider.restore(path.join(ref.directory, config.files.payload), {prefetch}));
            await measured('readiness', () => node.assert(provider, node.inputs));
            if (manifest.restoreValidation === config.checkpoint.restoreValidation && !ref.restoreValidated) {
                await measured('firstReuseValidation', async () => {
                    if (digest(await provider.normalizedState()) !== manifest.expectedStateDigest) {
                        throw new Error(messages.firstRestoreMismatch);
                    }
                });
                ref.restoreValidated = true;
                report.counts.firstReuseValidations = (report.counts.firstReuseValidations ?? 0) + 1;
            }
            report.counts.reuseHits++;
            const restoreMs = performance.now() - restoreStart;
            report.costs.restores.push({stage: id, ms: restoreMs});
            economics?.observe('restoreMs', restoreMs, id);
            emit(protocol.event.nodeEnd, {
                node: id,
                operation: protocol.operation.restore,
                status: protocol.status.passed,
                ms: performance.now() - restoreStart
            });
            return {parent: ref.id, lineage: [...manifest.lineage]};
        } catch (error) {
            invalidate(id, 'restore', protocol.operation.restore, error);
        }
        return null;
    }

    async function resolve(id, next) {
        const node = graph.stages.get(id);
        for (const ancestor of graph.chain(id))
            if (failed.has(ancestor.id)) throw new ParentFailure(ancestor.id, failed.get(ancestor.id));
        const ref = reuse && store.available.get(id);
        if (ref && economics && !economics.decide(id, measuredPrefix(id), remaining.get(id), {captured: true})) {
            // Release only owned, verified snapshot data; resolution below resets
            // through the same path as ordinary linear execution.
            await releaseCheckpoint(id);
            disabled.add(id);
        }
        if (ref && !disabled.has(id)) {
            const restored = await restoreCheckpoint(node, ref, next);
            if (restored) return restored;
        }
        const prior = node.parent
            ? await resolve(node.parent, next)
            : graph.nativePageLifecycle && provider.nextLinear && report.costs.resets.length &&
                !report.checkpoints.length && !report.counts.fallbacks
              ? await measured('linearStart', async () => {
                  const time = performance.now();
                  await provider.nextLinear();
                  (report.costs.linearStarts ??= []).push(performance.now()-time);
                  return {parent:null,lineage:[]};
              })
              : await measured('reset', async () => {
                  const time = performance.now();
                  await provider.reset();
                  const resetMs = performance.now() - time;
                  economics?.observe(report.costs.resets.length ? 'resetMs' : 'firstResetMs', resetMs, id);
                  report.costs.resets.push(resetMs);
                  return {parent: null, lineage: []};
              });
        prior.lineage.push(await measured('prefix', () => segment(node, 'Stage')));
        if (
            reuse &&
            node.checkpoint !== false &&
            (!chosen || chosen.has(id)) &&
            !disabled.has(id) &&
            (checkpointLifetime === config.checkpoint.lifetime || remaining.get(id) > 1) &&
            (!economics || economics.decide(id, measuredPrefix(id), remaining.get(id) - 1))
        ) {
            try {
                const time = performance.now();
                emit(protocol.event.nodeStart, {node: id, operation: protocol.operation.capture});
                if (adaptive && graph.nativePageLifecycle) {
                    const entry = report.segments.at(-1);
                    entry.coverage = (await provider.endSegment?.(entry.id)) ?? null;
                }
                const ref = await store.capture({
                    key: graph.key(id),
                    stage: id,
                    parent: prior.parent,
                    lineage: [...prior.lineage],
                    ttlMs,
                    provider,
                    measured,
                    assert: (runtime) => node.assert(runtime, node.inputs),
                    fault
                });
                const manifest = store.verify(ref, graph.key(id));
                const captureMs = performance.now() - time;
                report.costs.captures.push({stage: id, ms: captureMs});
                if (economics) {
                    economics.observe('captureMs', captureMs, id);
                    economics.lifecycleCharged = true;
                }
                report.checkpoints.push(manifest);
                prior.parent = ref.id;
                emit(protocol.event.checkpointReady, {
                    node: id,
                    checkpoint: ref.id,
                    ms: performance.now() - time
                });
            } catch (error) {
                invalidate(id, 'capture', protocol.operation.capture, error);
                // A failed validation may have partially mutated the runtime. Replay
                // from a verified ancestor, never continue from that partial restore.
                return resolve(id, next);
            }
        }
        return prior;
    }
    async function runSpec(spec, index) {
        const result = {
            spec: spec.id,
            status: protocol.status.running,
            inheritedSegments: [],
            observedSegments: []
        };
        const first = report.segments.length;
        emit(protocol.event.specStart, {node: spec.id, index});
        try {
            const next = selected[index + 1];
            const state = await resolve(spec.parent, next);
            // Resolve can publish a deeper checkpoint. The provider deduplicates
            // the earlier import or settles it before preparing that new snapshot.
            const prefetch = nextPrefetch(next);
            if (prefetch) await provider.prefetch(prefetch);
            result.parentCheckpoint = state.parent;
            result.lineage = [...state.lineage, await measured('suffix', () => segment(spec, 'Spec'))];
            const observed = new Set(report.segments.slice(first).map((item) => item.id));
            result.inheritedSegments = result.lineage.filter((id) => !observed.has(id));
            result.observedSegments = result.lineage.filter((id) => observed.has(id));
            result.state = await measured('terminalState', () => provider.normalizedState());
            result.status = protocol.status.passed;
        } catch (error) {
            result.status = error instanceof ParentFailure ? protocol.status.blocked : protocol.status.failed;
            result.blockedBy = error.stage ?? null;
            result.error = error.message;
            if (error instanceof ParentFailure) report.counts.blockedSpecs++;
            else errorRecord('scenario', error, error.stage);
        }
        report.results.push(result);
        emit(protocol.event.specEnd, {
            node: spec.id,
            status: result.status,
            blockedBy: result.blockedBy ?? null
        });
        await releaseConsumed(spec);
    }

    function measuredPrefix(id) {
        return graph.chain(id).reduce((sum, node) => sum + (prefixDurations.get(node.id) ?? 0), 0);
    }
    async function releaseCheckpoint(id, after = null) {
        try {
            const time = performance.now();
            const checkpoint = await measured('checkpointRelease', async () => store.release(id));
            if (checkpoint) {
                const ms = performance.now() - time;
                report.releases.push({stage: id, checkpoint, after});
                report.costs.releases.push({stage: id, ms});
                economics?.observe('releaseMs', ms, id);
                emit(protocol.event.checkpointReleased, {node: id, after});
            }
        } catch (error) {
            errorRecord('checkpointRelease', error, id);
            throw error;
        }
    }

    async function releaseConsumed(spec) {
        for (const node of graph.chain(spec.parent).reverse()) {
            remaining.set(node.id, remaining.get(node.id) - 1);
            emit(protocol.event.consumerFinished, {
                node: node.id,
                spec: spec.id,
                remaining: remaining.get(node.id)
            });
            if (
                checkpointLifetime === config.checkpoint.lastConsumer &&
                !retain &&
                remaining.get(node.id) === 0
            ) {
                await releaseCheckpoint(node.id, spec.id);
            }
        }
    }
    return {runSpec};
}
module.exports = {createExecution};
