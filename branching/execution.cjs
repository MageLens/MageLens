// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

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
    fault
}) {
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
        report.segments.push(entry);
        if (kind === 'Stage') report.counts.prefixExecutions++;
        const time = performance.now();
        emit(protocol.event.nodeStart, {node: node.id, operation: protocol.operation.execute});
        try {
            await provider.beginSegment?.(entry.id);
            await node.run(provider, node.inputs);
            await node.assert(provider, node.inputs);
            entry.coverage = (await provider.endSegment?.(entry.id)) ?? null;
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
    async function restoreCheckpoint(node, ref) {
        const id = node.id;
        const restoreStart = performance.now();
        emit(protocol.event.nodeStart, {node: id, operation: protocol.operation.restore});
        try {
            const manifest = await measured('reuseValidation', async () => store.verify(ref, graph.key(id)));
            await fault?.('beforeRestore', {ref, stage: id});
            // Recheck after external delays/fault hooks, before consuming any bytes.
            store.verify(ref, graph.key(id));
            await measured('restore', () => provider.restore(path.join(ref.directory, config.files.payload)));
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
            report.costs.restores.push({stage: id, ms: performance.now() - restoreStart});
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

    async function resolve(id) {
        const node = graph.stages.get(id);
        for (const ancestor of graph.chain(id))
            if (failed.has(ancestor.id)) throw new ParentFailure(ancestor.id, failed.get(ancestor.id));
        const ref = reuse && store.available.get(id);
        if (ref) {
            const restored = await restoreCheckpoint(node, ref);
            if (restored) return restored;
        }
        const prior = node.parent
            ? await resolve(node.parent)
            : await measured('reset', async () => {
                  const time = performance.now();
                  await provider.reset();
                  report.costs.resets.push(performance.now() - time);
                  return {parent: null, lineage: []};
              });
        prior.lineage.push(await measured('prefix', () => segment(node, 'Stage')));
        if (
            reuse &&
            node.checkpoint !== false &&
            (!chosen || chosen.has(id)) &&
            !disabled.has(id) &&
            (checkpointLifetime === config.checkpoint.lifetime || remaining.get(id) > 1)
        ) {
            try {
                const time = performance.now();
                emit(protocol.event.nodeStart, {node: id, operation: protocol.operation.capture});
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
                report.costs.captures.push({stage: id, ms: performance.now() - time});
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
                return resolve(id);
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
            const state = await resolve(spec.parent);
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
                try {
                    const time = performance.now();
                    if (store.available.has(node.id))
                        emit(protocol.event.nodeStart, {
                            node: node.id,
                            operation: protocol.operation.release
                        });
                    const checkpoint = await measured('checkpointRelease', async () =>
                        store.release(node.id)
                    );
                    if (checkpoint) {
                        report.releases.push({stage: node.id, checkpoint, after: spec.id});
                        report.costs.releases.push({stage: node.id, ms: performance.now() - time});
                        emit(protocol.event.checkpointReleased, {node: node.id, after: spec.id});
                    }
                } catch (error) {
                    errorRecord('checkpointRelease', error, node.id);
                }
            }
        }
    }
    return {runSpec};
}
module.exports = {createExecution};
