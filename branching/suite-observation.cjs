// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {randomUUID} = require('node:crypto');
const {events, describeGraph} = require('./events.cjs');

function observeSuite({eventDirectory, onEvent} = {}) {
    const run = randomUUID(), started = performance.now();
    const journal = events({run, directory: eventDirectory, onEvent});
    const cleanups = [];
    const counts = {prefixExecutions:0, reuseHits:0, fallbacks:0, failures:0, blockedSpecs:0};
    const emit = (type, data) => journal.emit(type, data);
    emit('run-start', {approach:'AUTO suite', checkpointLifetime:'last-consumer',
        policy:{basis:'measured-first-use'}, nodes:[], schedule:[]});
    emit('run-phase', {phase:'discovering'});
    return {
        run, emit, diagnostics:journal.diagnostics,
        discover(prepared) {
            const {inventory, blocks, ordering} = prepared;
            const nodes = inventory.tests.map(test => ({id:test.id, label:test.title, kind:'test', parent:null,
                source:{file:test.file,line:test.line}, consumers:[], releasePolicy:'none'}));
            const tests = new Map(nodes.map(node => [node.id,node]));
            const excludedCandidates = [];
            for (const [index, block] of blocks.entries()) {
                if (!block.built) continue;
                const graph = block.built.workflow;
                const ids = new Map(block.tests.map(test=>[test.staticId,test.id]));
                block.observationId = id => ids.get(id) ?? `group-${index}:${id}`;
                const selected = new Set(block.decision.selected);
                for (const node of describeGraph(graph,graph.select(),{approach:'branching',checkpointLifetime:'last-consumer',chosen:selected})) {
                    const mapped = {...node,id:block.observationId(node.id),parent:node.parent ? block.observationId(node.parent) : null,
                        consumers:node.consumers.map(block.observationId),lastConsumer:node.lastConsumer ? block.observationId(node.lastConsumer) : null};
                    if (node.kind==='test') Object.assign(tests.get(mapped.id),mapped);
                    else nodes.push(mapped);
                }
                for (const excluded of block.excludedCandidates ?? []) excludedCandidates.push({...excluded,
                    id:block.observationId(excluded.id), selected:block.observationId(excluded.selected)});
            }
            emit('discovery-complete',{nodes,schedule:ordering.scheduled,
                ordering:{...ordering,original:inventory.tests.map(t=>t.id),execution:ordering.scheduled},excludedCandidates});
        },
        child(block) {
            return event => {
                if (event.type === 'cleanup-end') {
                    cleanups.push(event);
                    emit('group-cleanup',{nodes:[...block.built.workflow.stages.keys()].map(block.observationId),
                        storageReleased:event.storageReleased,retained:event.retained,failed:event.failed});
                    return;
                }
                if (['run-start','run-end','checkpoint-baseline'].includes(event.type)) return;
                const {schemaVersion:_schema, run:_run, sequence:_sequence, time:_time, type, ...data} = event;
                if (data.node) data.node=block.observationId(data.node);
                if (data.after) data.after=block.observationId(data.after);
                if (data.spec) data.spec=block.observationId(data.spec);
                if (data.blockedBy) data.blockedBy=block.observationId(data.blockedBy);
                if (data.decision) data.decision={...data.decision,stage:block.observationId(data.decision.stage)};
                if (data.observation) data.observation={...data.observation,stage:block.observationId(data.observation.stage)};
                emit(type,data);
            };
        },
        add(report) { for (const key of Object.keys(counts)) counts[key]+=report.counts[key] ?? 0; },
        async finish(report, {cleanupFailed=false} = {}) {
            cleanupFailed ||= cleanups.some(item=>item.failed);
            emit('cleanup-end',{storageReleased:!cleanupFailed && cleanups.every(item=>item.storageReleased),
                retained:cleanups.some(item=>item.retained),failed:cleanupFailed});
            if (cleanupFailed || !report || report.status === 'failed') counts.failures=Math.max(1,counts.failures);
            emit('run-end',{status:cleanupFailed ? 'failed' : report?.status ?? 'failed',counts,
                wallMs:performance.now()-started});
            await journal.close();
        }
    };
}
module.exports = {observeSuite};
