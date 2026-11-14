// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {Economics, candidates} = require('../branching/adaptive.cjs');
const {defaults} = require('../branching/baseline.cjs');
const {Graph, execute} = require('../branching/engine.cjs');
const {FixtureProvider, fixtureWorkflow} = require('./fixtures/branching/provider.cjs');
const baseline = {...defaults, captureMs: 1, restoreMs: 1, releaseMs: 1, resetMs: 1, firstResetMs: 1, backendMs: 1};

test('first use counts only remaining consumers and charges complete costs once', () => {
    const e = new Economics(baseline);
    assert.equal(e.decide('prefix', 1, 8), false);
    assert.equal(e.decide('prefix', 100, 2), true);
    assert.deepEqual(e.decisions.at(-1).components, {capture: 1, restore: 2, release: 1, lifecycle: 2});
    assert.equal(e.decisions.at(-1).avoidedMs, 200);
    e.lifecycleCharged = true;
    e.decide('next', 100, 2);
    assert.equal(e.decisions.at(-1).components.lifecycle, 0);
    e.decide('prefix', 100, 2, {captured: true});
    assert.deepEqual(e.decisions.at(-1).components, {capture: 0, restore: 2, release: 0, lifecycle: 0});
});
test('first restore recalibrates only restore and revisits subsequent decisions', () => {
    const e = new Economics(baseline);
    assert.equal(e.decide('prefix', 100, 2), true);
    e.observe('restoreMs', 150, 'prefix');
    assert.deepEqual(e.baseline, {...baseline, restoreMs: 150});
    assert.equal(e.decide('prefix', 100, 1, {captured: true}), false);
    assert.equal(e.decide('next', 100, 2), false);
    e.observe('restoreMs', 5, 'prefix');
    assert.equal(e.baseline.restoreMs, 150);
});
test('nested candidates cannot spend the same avoided work twice or reorder specs', () => {
    const graph = new Graph(fixtureWorkflow());
    const before = graph.select().map(s => s.id);
    const plan = candidates(graph);
    for (const spec of graph.select()) assert.ok(graph.chain(spec.parent).filter(n => plan.selected.includes(n.id)).length <= 1);
    assert.deepEqual(graph.select().map(s => s.id), before);
});
function setup(t, expensive) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-adaptive-'));
    t.after(() => fs.rmSync(root, {force: true, recursive: true}));
    const workflow = fixtureWorkflow({recursive: false, fanout: 3});
    workflow.costBaseline = baseline;
    if (expensive) {
        const run = workflow.stages[1].run;
        workflow.stages[1].run = async (...args) => { await delay(100); await run(...args); };
    }
    return {root, workflow, provider: new FixtureProvider()};
}
test('cheap first use continues linearly without a separate profiling execution', async t => {
    const report = await execute(setup(t, false));
    assert.equal(report.status, 'passed');
    assert.equal(report.checkpoints.length, 0);
    assert.equal(report.results.length, 4);
    assert.equal(report.counts.prefixExecutions, 12);
    assert.equal(report.adaptive.decisions[0].remaining, 3);
});
test('expensive first use captures once; costly first restore abandons safely', async t => {
    const options = setup(t, true);
    const restore = options.provider.restore.bind(options.provider);
    options.provider.resumeCapture = async () => {};
    options.provider.restore = async directory => { await delay(200); await restore(directory); };
    const report = await execute(options);
    assert.equal(report.status, 'passed');
    assert.equal(report.checkpoints.length, 1);
    assert.equal(report.counts.reuseHits, 1);
    assert.equal(report.counts.fallbacks, 0);
    assert.equal(report.results.length, 4);
    assert.equal(report.releases.length, 1);
    assert.ok(report.adaptive.observations.some(o => o.component === 'restoreMs' && o.ms >= 200));
    assert.ok(report.adaptive.decisions.some(d => d.captured && !d.reuse));
    assert.deepEqual(fs.readdirSync(options.root), []);
});
test('failed restore preserves failure even when linear recovery succeeds', async t => {
    const options = setup(t, true);
    options.provider.resumeCapture = async () => {};
    options.provider.restore = async () => { throw new Error('restore failed'); };
    const report = await execute(options);
    assert.equal(report.status, 'failed');
    assert.ok(report.errors.some(e => e.phase === 'restore' && e.message === 'restore failed'));
    assert.equal(report.counts.reuseHits, 0);
    assert.equal(report.results.length, 4);
    assert.ok(!report.adaptive.observations.some(o => o.component === 'restoreMs'));
});

test('automatic prefix measurement ends after awaited test work, before provider verification', async t => {
    const options=setup(t,true);
    const stage=options.workflow.stages[1];
    stage.inputs={fromDepth:0,checkpoint:{depth:1}};
    const verify=stage.assert;
    stage.assert=async (...args)=>{await delay(100);await verify(...args);};
    const report=await execute(options);
    assert.equal(report.status,'passed');
    const first=report.segments.find(segment=>segment.node===stage.id);
    assert.ok(first.prefixTiming.workCompleted);
    const measured=report.segments.filter(segment=>segment.kind==='Stage').slice(0,3)
        .reduce((sum,segment)=>sum+(segment.prefixTiming?.workMs??segment.wallMs),0);
    assert.equal(report.adaptive.decisions[0].prefixMs,measured);
    assert.ok(first.wallMs>first.prefixTiming.workMs);
});

test('uneconomic native page consumers preserve application/cache continuity and isolate browser state', async t => {
    const options=setup(t,false);
    let verifications=0, starts=0;
    options.workflow={identity:options.workflow.identity,nativePageLifecycle:true,costBaseline:baseline,
        stages:[{id:'shared',inputs:{fromDepth:0,checkpoint:{depth:1}},run:async p=>{p.state.db.visits=(p.state.db.visits??0)+1;},assert:async()=>{verifications++;}}],
        specs:[0,1,2].map(index=>({id:'consumer-'+index,parent:'shared',run:async p=>{
            assert.deepEqual(p.state.browser.cookies,[]);
            assert.equal(p.state.db.visits,index+1);
            p.state.browser.cookies.push('isolated');
        },assert:async()=>{}}))};
    options.provider.nextLinear=async()=>{starts++;options.provider.state.browser.cookies=[];};
    const report=await execute(options);
    assert.equal(report.status,'passed'); assert.equal(report.checkpoints.length,0);
    assert.equal(report.costs.resets.length,1); assert.equal(report.costs.linearStarts.length,2);
    assert.equal(starts,2); assert.equal(verifications,0,'Rejected boundaries cannot pause tests for unnecessary restoration checks');
});
test('native page continuity never replaces the verified reset after abandoning a checkpoint', async t => {
    const options=setup(t,true);
    options.workflow.nativePageLifecycle=true;
    options.provider.nextLinear=async()=>assert.fail('Abandonment must restore the verified baseline');
    const restore=options.provider.restore.bind(options.provider);
    options.provider.resumeCapture=async()=>{};
    options.provider.restore=async directory=>{await delay(200);await restore(directory);};
    const report=await execute(options);
    assert.equal(report.status,'passed'); assert.equal(report.checkpoints.length,1);
    assert.equal(report.counts.reuseHits,1); assert.ok(report.costs.resets.length>=2);
    assert.ok(report.adaptive.decisions.some(decision=>decision.captured&&!decision.reuse));
});
