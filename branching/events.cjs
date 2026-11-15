// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const config = require('./configs/runtime.cjs');

const path = require('node:path');
const {Worker} = require('node:worker_threads');

// The runner only snapshots small metadata. A separate worker batches journal
// I/O even while application/Docker commands occupy the runner's event loop.
function events({run, directory, onEvent}) {
    const diagnostics = {enabled: Boolean(directory || onEvent), events: 0, error: null};
    let worker, sequence = 0, pendingBytes = 0, disabled = false, closed = false;
    let callbacks = Promise.resolve();
    const completed = Promise.withResolvers();
    function fail() {
        diagnostics.error = 'Live observation failed; inspect the runner report for execution results.';
        disabled = true;
    }
    if (diagnostics.enabled) {
        try {
            worker = new Worker(path.join(__dirname, 'events-worker.cjs'), {workerData: {
                run, directory, callback: Boolean(onEvent), uid: process.env.MAGELENS_HOST_UID, gid: process.env.MAGELENS_HOST_GID}});
            worker.on('message', message => {
                if (message.type === 'error') { fail(); return; }
                pendingBytes -= message.bytes; diagnostics.events += message.count;
                if (onEvent) callbacks = callbacks.then(async () => {
                    if (!disabled) for (const encoded of message.entries) await onEvent(JSON.parse(encoded));
                }).catch(fail);
            });
            worker.on('error', fail);
            worker.on('exit', code => { if (code !== 0) fail(); completed.resolve(); });
        } catch { fail(); completed.resolve(); }
    } else completed.resolve();
    return {
        diagnostics,
        emit(type, data = {}) {
            if (!diagnostics.enabled || disabled || closed) return;
            try {
                const encoded = JSON.stringify({schemaVersion: 1, run, sequence: ++sequence, time: Date.now(), type, ...data});
                const bytes = Buffer.byteLength(encoded) + 1;
                pendingBytes += bytes;
                if (pendingBytes > 4 * 1024 * 1024) throw new Error('Observation queue full');
                worker.postMessage({type: 'event', encoded, bytes});
            } catch { fail(); }
        },
        async close() {
            if (closed) return; closed = true;
            worker?.postMessage({type: 'close'});
            let timer;
            // Cleanup has already finished. Bound this final drain so a broken
            // observer cannot hold an otherwise completed run indefinitely.
            await Promise.race([completed.promise.then(() => callbacks), new Promise(resolve => {
                timer = setTimeout(() => { fail(); Promise.resolve(worker?.terminate()).then(resolve); }, 1000);
            })]);
            clearTimeout(timer);
        }
    };
}

function describeGraph(graph, selected, {approach, checkpointLifetime, retain, chosen}) {
    const used = new Set(selected.flatMap(spec => graph.chain(spec.parent).map(node => node.id)));
    const stages = [...graph.stages.values()].filter(node => used.has(node.id));
    const consumersById = new Map(stages.map(node => [node.id, selected.filter(spec => graph.chain(spec.parent).some(parent => parent.id === node.id)).map(spec => spec.id)]));
    const eligible = node => node.checkpoint !== false && approach === config.APPROACH.branching && (!chosen || chosen.has(node.id)) &&
        (checkpointLifetime === config.checkpoint.lifetime || consumersById.get(node.id).length > 1);
    return [...stages, ...selected].map(node => {
        const test = graph.specs.has(node.id);
        const consumers = test ? [] : consumersById.get(node.id);
        const checkpoint = !test && eligible(node);
        const depth = test ? null : graph.chain(node.id).filter(eligible).length;
        return {id: node.id, label: node.label ?? node.id, parent: node.parent ?? null,
            kind: test ? 'test' : checkpoint ? 'checkpoint' : 'step', depth,
            source: node.source ?? null, estimatedMs: node.estimatedMs ?? null,
            consumers, lastConsumer: consumers.at(-1) ?? null,
            releasePolicy: !checkpoint ? 'none' : retain ? 'retained' : checkpointLifetime};
    });
}
module.exports = {events, describeGraph};
