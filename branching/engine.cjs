// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const protocol = require('./configs/protocol.cjs');

const messages = require('./configs/messages.cjs');

const config = require('./configs/runtime.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {events, describeGraph} = require('./events.cjs');
const {limitCheckpoints} = require('./checkpoint-limit.cjs');
const {Graph} = require('./graph.cjs');
const {CheckpointStore} = require('./checkpoint-store.cjs');
const {cleanupRun} = require('./run-cleanup.cjs');
const {createExecution} = require('./execution.cjs');
const {createReport, reporting, startTiming} = require('./run-report.cjs');
const {write, cleanup, inventory} = require('./checkpoint-files.cjs');
const {canonical, digest, fileDigest} = require('./identity.cjs');
async function execute({
    workflow,
    provider,
    approach = config.APPROACH.branching,
    specs,
    root,
    ttlMs = config.checkpoint.ttlMs,
    fault,
    retain = false,
    checkpointLifetime = config.checkpoint.lifetime,
    checkpointSelection,
    checkpointPolicy,
    eventDirectory = process.env.MAGELENS_BRANCHING_EVENTS,
    onEvent
}) {
    const graph = workflow instanceof Graph ? workflow : new Graph(workflow),
        selected = graph.select(specs);
    if (!config.executionApproaches.includes(approach)) throw new Error(messages.unknownExecutionApproach);
    if (!provider.approaches.includes(approach)) throw new Error(messages.providerDoesNotImplement(approach));
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error(messages.invalidCheckpointTtl);
    if (![config.checkpoint.lifetime, config.checkpoint.lastConsumer].includes(checkpointLifetime))
        throw new Error(messages.invalidCheckpointLifetime);
    if (checkpointSelection !== undefined && !Array.isArray(checkpointSelection))
        throw new Error(messages.invalidCheckpointSelection);
    const requested = checkpointSelection === undefined ? null : new Set(checkpointSelection);
    if (
        requested &&
        (requested.size !== checkpointSelection.length ||
            [...requested].some((id) => !graph.stages.has(id) || graph.stages.get(id).checkpoint === false))
    )
        throw new Error(messages.invalidCheckpointSelection);
    const limited = limitCheckpoints(graph, selected, {requested, approach, checkpointLifetime}),
        chosen = limited.chosen;
    const clock = startTiming();
    const run = randomUUID();
    fs.mkdirSync(root, {recursive: true, mode: 0o700});
    const directory = fs.mkdtempSync(path.join(root, config.files.runPrefix));
    write(path.join(directory, config.files.owner), {
        schemaVersion: 1,
        kind: config.checkpoint.ownerKind,
        run
    });
    const report = createReport({
        run,
        approach,
        provider,
        graph,
        directory,
        checkpointLifetime,
        checkpointPolicy,
        limited
    });
    const observer = events({run, directory: eventDirectory, onEvent});
    report.observation = observer.diagnostics;
    const emit = (type, data = {}) => observer.emit(type, data);
    if (observer.diagnostics.enabled)
        emit(protocol.event.runStart, {
            approach,
            checkpointLifetime,
            retain,
            schedule: selected.map((spec) => spec.id),
            nodes: describeGraph(graph, selected, {approach, checkpointLifetime, retain, chosen}),
            policy: checkpointPolicy
                ? {reason: checkpointPolicy.reason, selected: checkpointPolicy.selected}
                : null,
            checkpointLimit: limited.report
        });
    const metrics = reporting(report, emit, clock);
    const {measured, errorRecord} = metrics;
    const store = new CheckpointStore(
        directory,
        run,
        digest({identity: graph.identity, provider: provider.identity})
    );
    const execution = createExecution({
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
    });
    try {
        emit(protocol.event.runPhase, {phase: 'preparing'});
        await measured('prepare', () => provider.prepare({run, directory, approach}));
        emit(protocol.event.runPhase, {phase: protocol.status.running});
        for (const [index, spec] of selected.entries()) await execution.runSpec(spec, index);
    } catch (error) {
        errorRecord('prepare', error);
    } finally {
        await cleanupRun({provider, report, measured, errorRecord, emit, directory, run, retain});
    }
    emit(protocol.event.cleanupEnd, {
        storageReleased: !fs.existsSync(directory),
        retained: retain,
        failed: report.errors.some((error) => error.phase === 'cleanup')
    });
    metrics.finish(provider, selected);
    emit(protocol.event.runEnd, {
        status: report.status,
        counts: report.counts,
        wallMs: report.metrics.wallMs
    });
    await observer.close();
    // Include final asynchronous journal drainage in measured execution cost.
    metrics.updateTiming();
    return report;
}
module.exports = {Graph, CheckpointStore, execute, cleanup, digest, canonical, fileDigest, inventory};
