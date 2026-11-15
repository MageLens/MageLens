// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {applyEvent} = require('../branching/dashboard/model.cjs');
const {startDashboard} = require('../branching/dashboard/server.cjs');
const {execute} = require('../branching/engine.cjs');
const {FixtureProvider, fixtureWorkflow} = require('./fixtures/branching/provider.cjs');
const {journey, baseline, schedule, withDiscoveredGraph} = require('./fixtures/branching/dashboard-adaptive.cjs');
const reduce = events => events.reduce(applyEvent, null);
// Isolate lifecycle assertions from discovery insertion so each missing feature
// fails on its own contract. The discovery/HTTP tests above and below use the
// complete empty-to-populated stream.
const view = events => reduce(withDiscoveredGraph(events));
const prefix = state => state.nodes.find(node => node.id === 'prefix');

test('two independent prefixes publish separate real captures and never double-count tests or reuse', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-multiple-prefixes-'));
    t.after(() => fs.rmSync(root, {recursive:true,force:true}));
    const workflow = fixtureWorkflow();
    workflow.costBaseline = {...baseline,captureMs:1,restoreMs:1,releaseMs:1,resetMs:1,firstResetMs:1,backendMs:1};
    workflow.stages = ['catalog','checkout'].map(id=>({id,run:async p=>{await delay(100);p.hit(id);},assert:async()=>{}}));
    workflow.specs = workflow.stages.flatMap(({id})=>[0,1,2].map(i=>({id:`${id}-${i}`,parent:id,run:async p=>p.hit(`${id}-${i}`),assert:async()=>{}})));
    const provider = new FixtureProvider(); provider.resumeCapture = async()=>{};
    const events = [], report = await execute({root,workflow,provider,onEvent:event=>events.push(event)});
    const state = reduce(events);
    assert.equal(report.status,'passed');
    assert.equal(report.results.length,6);
    assert.equal(report.checkpoints.length,2);
    assert.equal(report.counts.prefixExecutions,2);
    assert.equal(report.counts.reuseHits,4);
    assert.deepEqual(state.counts,report.counts);
    for (const id of ['catalog','checkout']) {
        const node = state.nodes.find(n=>n.id===id);
        assert.equal(node.executions,1); assert.equal(node.restores,2);
        assert.equal(node.decisions[0].remaining,2);
    }
});

test('discovery populates a live run without a prebuilt manifest and preserves safe order', () => {
    const events = journey('measuring');
    const waiting = reduce(events.slice(0, 2));
    assert.equal(waiting.phase, 'discovering');
    assert.deepEqual(waiting.nodes, []);
    const discovered = reduce(events.slice(0, 3));
    assert.equal(discovered.nodes.length, 6, 'Discovery must insert candidates and every original test');
    assert.deepEqual(discovered.schedule, schedule);
    assert.deepEqual(discovered.ordering, {original: schedule, execution: schedule, changed: false});
    assert.equal(prefix(discovered).checkpointState, 'candidate');
    assert.equal(discovered.nodes.filter(n => n.kind === 'checkpoint').length, 1, 'Overlapping ancestor is not another saving');
    assert.deepEqual(discovered.excludedCandidates, [{id: 'ancestor', reason: 'overlapping-prefix', selected: 'prefix'}]);
});

test('awaited first use is measuring, never an available or already selected checkpoint', () => {
    const state = view(journey('measuring'));
    assert.equal(prefix(state).checkpointState, 'measuring');
    assert.equal(prefix(state).decision, undefined);
    assert.equal(state.counts.reuseHits, 0);
});

test('cheap prefix explains linear execution using remaining consumers and full incremental costs', () => {
    const state = view(journey('linear')), node = prefix(state);
    assert.equal(node.checkpointState, 'linear');
    assert.equal(node.decision.remaining, 2, 'The first required execution is not a saving');
    assert.equal(node.decision.avoidedMs, 2);
    assert.deepEqual(node.decision.components, {capture: 100, restore: 200, release: 10, lifecycle: 50});
    assert.equal(node.decision.costMs, 360);
    assert.equal(node.decision.reuse, false);
    assert.equal(state.counts.reuseHits, 0);
});

test('profitable selection is capturing until publication, with no premature reuse credit', () => {
    const state = view(journey('capturing'));
    assert.equal(prefix(state).checkpointState, 'capturing');
    assert.equal(prefix(state).decision.reuse, true);
    assert.equal(state.nodes.filter(n => n.checkpointState === 'available').length, 0);
    const restoring = view(journey('restoring'));
    assert.equal(prefix(restoring).checkpointState, 'available');
    assert.equal(restoring.counts.reuseHits, 0, 'Readiness and state verification have not completed');
});

test('first complete restore updates only its cost and revises remaining economics with capture sunk', () => {
    const state = view(journey('abandoning'));
    assert.deepEqual(state.baseline.before, baseline);
    assert.deepEqual(state.baseline.current, {...baseline, restoreMs: 1500});
    assert.deepEqual(state.baseline.observations, [{stage: 'prefix', component: 'restoreMs', ms: 1500, before: 100, after: 1500, count:1, meanMs:1500}]);
    assert.equal(state.counts.reuseHits, 1);
    const node = prefix(state);
    assert.equal(node.decision.remaining, 1);
    assert.deepEqual(node.decision.components, {capture: 0, restore: 1500, release: 0, lifecycle: 0});
    assert.equal(node.decision.reuse, false);
    assert.equal(node.checkpointState, 'abandoning', 'Do not imply verified fallback before release and reset');
    assert.equal(node.decisions.length, 2, 'Keep the original capture decision visible');
});

test('safe abandonment preserves tests, reuse history and its economic reason after cleanup', () => {
    const state = view(journey('finished'));
    assert.equal(prefix(state).checkpointState, 'released');
    assert.equal(prefix(state).reuseState, 'abandoned');
    assert.equal(prefix(state).releaseReason, 'uneconomic');
    assert.equal(prefix(view(journey('abandoned'))).remaining, 1, 'Releasing storage cannot mark unexecuted consumers complete');
    assert.equal(prefix(state).remaining, 0);
    assert.equal(state.nodes.filter(n => n.kind === 'test' && n.status === 'passed').length, 5);
    assert.equal(state.counts.reuseHits, 1);
    assert.equal(state.counts.fallbacks, 0);
    assert.equal(state.wallMs, 4000, 'Use total elapsed time, not projected avoided work');
    assert.equal(state.savingsPercent, undefined, 'No measured linear comparison was supplied');
});

test('restore failure remains failure after cleanup and never recalibrates from an unsuccessful restore', () => {
    const state = view(journey('failed'));
    assert.equal(state.status, 'failed');
    assert.equal(state.counts.reuseHits, 0);
    assert.equal(prefix(state).lastError, 'restore');
    assert.notEqual(prefix(state).reuseState, 'abandoned');
    assert.deepEqual(state.baseline.current, baseline);
    assert.deepEqual(state.baseline.observations, []);
});

test('failed abandonment reset cannot be presented as a successful economic fallback', () => {
    const events = journey('abandoning');
    for (const [type, data] of [
        ['checkpoint-released', {node: 'prefix', after: 'b', reason: 'uneconomic', ms: 10}],
        ['run-error', {node: 'prefix', phase: 'reset'}],
        ['cleanup-end', {storageReleased: false, retained: false, failed: true}],
        ['run-end', {status: 'failed', wallMs: 3000, counts: {reuseHits: 1, failures: 1, fallbacks: 0}}]
    ]) events.push({...events[0], sequence: events.length + 1, type, ...data});
    const state = view(events);
    assert.equal(state.status, 'failed');
    assert.equal(state.cleanup.failed, true);
    assert.equal(prefix(state).lastError, 'reset');
    assert.equal(prefix(state).reuseState, 'abandoning', 'Verified reset was never confirmed');
    assert.notEqual(state.nodes.find(n => n.id === 'c').status, 'passed');
});

test('incompatible measurements use conservative bootstrap estimates and learn from actual restoration only', () => {
    const events = journey('bootstrap');
    const state = reduce(events);
    assert.equal(state.baseline.status,'estimated');
    assert.equal(state.baseline.reason,'incompatible-measurements-ignored');
    assert.deepEqual(state.baseline.current,baseline);
    assert.ok(state.baseline.current.restoreMs>0);
    assert.equal(events.some(event=>event.phase==='calibrating'),false);
    assert.deepEqual(state.baseline.observations,[]);
});

test('manifest-free HTTP snapshots and journal replay retain the same evolving economics', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-adaptive-view-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const app = await startDashboard({directory, port: 0}); t.after(() => app.close());
    const events = journey('finished'), file = path.join(directory, events[0].run + '.ndjson');
    for (const end of [3, events.length]) {
        fs.writeFileSync(file, events.slice(0, end).map(e => JSON.stringify(e)).join('\n') + '\n');
        await app.scan();
        const snapshot = await (await fetch(app.url + '/api/state')).json();
        assert.deepEqual(snapshot.warnings, []);
        assert.equal(snapshot.plan, null);
        assert.deepEqual(snapshot.runs[0], reduce(events.slice(0, end)));
        assert.equal(snapshot.runs[0].nodes.length, 6);
    }
});

for (const expensive of [false, true]) test(`real adaptive engine publishes every ${expensive ? 'capture and recalibration' : 'linear decision'} before run end`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-adaptive-events-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const workflow = fixtureWorkflow({recursive: false, fanout: 3});
    workflow.costBaseline = {...baseline, captureMs: 1, restoreMs: 1, releaseMs: 1, resetMs: 1, firstResetMs: 1, backendMs: 1};
    if (expensive) {
        const original = workflow.stages[1].run;
        workflow.stages[1].run = async (...args) => { await delay(100); await original(...args); };
    } else workflow.costBaseline.restoreMs = 1000000;
    const provider = new FixtureProvider(), events = [];
    provider.resumeCapture = async () => {};
    const report = await execute({root, workflow, provider, onEvent: event => events.push(event)});
    assert.equal(report.status, 'passed');
    assert.ok(report.adaptive.decisions.length > 0);
    assert.deepEqual(events.filter(e => e.type === 'checkpoint-decision').map(e => e.decision), report.adaptive.decisions,
        'The real producer, not just a synthetic viewer fixture, must publish its decisions');
    assert.deepEqual(events.filter(e => e.type === 'checkpoint-cost-observed').map(e => e.observation), report.adaptive.observations);
    const capture = events.findIndex(e => e.type === 'checkpoint-ready');
    if (expensive) assert.ok(events.findIndex(e => e.type === 'checkpoint-decision') < capture);
    assert.equal(events.at(-1).type, 'run-end');
    assert.equal(JSON.stringify(events).includes('synthetic-session'), false);
});
