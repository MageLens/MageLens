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

test('cold-start estimates are not samples; repeated actual restores refine their own running mean', () => {
    const e=new Economics({...baseline,restoreMs:9000});
    e.observe('restoreMs',100,'first');
    assert.equal(e.baseline.restoreMs,100);
    assert.deepEqual(e.statistics.restoreMs,{count:1,sumMs:100});
    e.observe('restoreMs',300,'second');
    assert.equal(e.observations.at(-1).meanMs,200);
    assert.equal(e.baseline.restoreMs,300,'A new slowdown affects the next decision immediately');
    e.observe('restoreMs',100,'third');
    assert.equal(e.baseline.restoreMs,500/3,'A later sample refines the estimate instead of retaining an eternal peak');
    assert.deepEqual(e.statistics.captureMs,{count:0,sumMs:0});
    assert.equal(e.baseline.captureMs,baseline.captureMs);
    assert.throws(()=>e.observe('restoreMs',NaN,'failed'),/Invalid/);
    assert.deepEqual(e.statistics.restoreMs,{count:3,sumMs:500});
});

test('compatible sample counts carry across groups and runs without counting estimates as measurements', () => {
    const statistics={restoreMs:{count:3,sumMs:600}};
    const first=new Economics({...baseline,restoreMs:200},undefined,statistics);
    first.observe('restoreMs',400,'group-one');
    const next=new Economics(first.baseline,undefined,first.statistics);
    next.observe('restoreMs',100,'group-two');
    assert.deepEqual(next.statistics.restoreMs,{count:5,sumMs:1100});
    assert.equal(next.baseline.restoreMs,220);
    assert.deepEqual(statistics,{restoreMs:{count:3,sumMs:600}},'Caller evidence stays immutable');
});

test('first use counts only remaining consumers and charges complete costs once', () => {
    const e = new Economics(baseline);
    assert.equal(e.decide('prefix', 1, 8), false);
    assert.equal(e.decide('prefix', 100, 2), true);
    assert.deepEqual(e.decisions.at(-1).components, {capture: 1, restore: 2, release: 1, transition:0, lifecycle: 2});
    assert.equal(e.decisions.at(-1).avoidedMs, 200);
    e.lifecycleCharged = true;
    e.decide('next', 100, 2);
    assert.equal(e.decisions.at(-1).components.lifecycle, 0);
    e.decide('prefix', 100, 2, {captured: true});
    assert.deepEqual(e.decisions.at(-1).components, {capture: 0, restore: 2, release: 0, transition:0, lifecycle: 0});
});
test('first restore recalibrates only restore and revisits subsequent decisions', () => {
    const e = new Economics(baseline);
    assert.equal(e.decide('prefix', 100, 2), true);
    e.observe('restoreMs', 150, 'prefix');
    assert.deepEqual(e.baseline, {...baseline, restoreMs: 150});
    assert.equal(e.decide('prefix', 100, 1, {captured: true}), false);
    assert.equal(e.decide('next', 100, 2), false);
    e.observe('restoreMs', 5, 'prefix');
    assert.equal(e.baseline.restoreMs, 77.5);
    assert.deepEqual(e.statistics.restoreMs,{count:2,sumMs:155});
    assert.equal(e.observations.at(-1).meanMs,77.5);
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
    const lifecycle = report.adaptive.observations.find(o => o.component === 'backendMs');
    assert.equal(lifecycle.ms, report.phases.prepare + report.phases.cleanup);
    assert.equal(lifecycle.stage, null);
    assert.equal(lifecycle.count, 1);
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
    let linearStarts=0;
    options.provider.nextLinear=async()=>{linearStarts++;options.provider.state.browser.cookies=[];};
    const restore=options.provider.restore.bind(options.provider);
    options.provider.resumeCapture=async()=>{};
    options.provider.restore=async directory=>{await delay(200);await restore(directory);};
    const report=await execute(options);
    assert.equal(report.status,'passed'); assert.equal(report.checkpoints.length,1);
    assert.equal(report.counts.reuseHits,1); assert.equal(report.costs.resets.length,2);
    assert.equal(linearStarts,1,'Linear lifecycle resumes after the one verified transition reset');
    assert.ok(report.adaptive.decisions.some(decision=>decision.captured&&!decision.reuse));
});
test('leaving a captured group resets once and charges the transition before capture',async t=>{
    const options=setup(t,false);
    options.workflow={identity:options.workflow.identity,nativePageLifecycle:true,costBaseline:baseline,
        stages:[{id:'expensive',run:async()=>delay(100),assert:async()=>{}},
            {id:'cheap',run:async()=>{},assert:async()=>{}}],
        specs:[...Array.from({length:2},(_,i)=>({id:'expensive-'+i,parent:'expensive',run:async()=>{},assert:async()=>{}})),
            ...Array.from({length:8},(_,i)=>({id:'cheap-'+i,parent:'cheap',run:async()=>{},assert:async()=>{}}))]};
    options.provider.resumeCapture=async()=>{};
    options.provider.nextLinear=async()=>{options.provider.state.browser.cookies=[];};
    const report=await execute(options);
    assert.equal(report.status,'passed');assert.equal(report.results.length,10);
    assert.equal(report.checkpoints.length,1);assert.equal(report.counts.reuseHits,1);
    assert.equal(report.costs.resets.length,2);assert.equal(report.costs.linearStarts.length,7);
    assert.equal(report.adaptive.decisions[0].components.transition,baseline.resetMs);
    const e=new Economics({...baseline,resetMs:1000});
    assert.equal(e.decide('group',100,1,{transitionReset:true}),false);
    assert.equal(e.decide('group',100,1,{captured:true,transitionReset:true}),true,
        'The exit reset is common to continuing and abandoning an existing checkpoint');
});
