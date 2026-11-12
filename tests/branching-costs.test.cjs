// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Graph,execute}=require('./fixtures/branching/engine.cjs');
const autoExecute=require('../branching/engine.cjs').execute;
const costs=require('../branching/costs.cjs');
const {costInput}=costs;
const {FixtureProvider,fixtureWorkflow}=require('./fixtures/branching/provider.cjs');
const {deepWorkflow}=require('./fixtures/branching/deep-workflow.cjs');

test('provider mechanism enforces the nine-checkpoint limit while preserving actions, outcomes and cleanup', async t => {
    const {root} = setup(t), workflow = new Graph(deepWorkflow());
    const base = {root, workflow, checkpointLifetime: 'last-consumer'};
    const linear = await execute({...base, approach: 'L0', provider: new FixtureProvider()});
    for (const options of [{}, {checkpointSelection: [...workflow.stages.keys()]}]) {
        const events = [], report = await execute({...base, ...options, provider: new FixtureProvider(), onEvent: e => events.push(e)});
        assert.equal(report.status, 'passed');
        assert.deepEqual(report.results.map(r => r.state), linear.results.map(r => r.state));
        assert.equal(report.checkpointLimit.maxCheckpointsPerTest, 9);
        assert.equal(report.checkpointLimit.selected.length, 9);
        assert.ok(!report.checkpointLimit.selected.includes('stage-00'));
        for (const spec of workflow.specs.values()) assert.ok(workflow.chain(spec.parent).filter(n => report.checkpointLimit.selected.includes(n.id)).length <= 9);
        assert.equal(report.checkpointLimit.warnings.length, 6);
        assert.equal(report.releases.length, report.checkpoints.length);
        assert.equal(fs.existsSync(report.directory), false);
        assert.equal(events[0].nodes.filter(n => n.kind === 'checkpoint').length, 9);
        assert.equal(events[0].checkpointLimit.warnings.length, 6);
    }
});
test('a configured four-checkpoint budget preserves all twelve stages and releases every snapshot', async t => {
    const {root} = setup(t), workflow = new Graph({...deepWorkflow(), maxCheckpointsPerTest: 4});
    assert.equal(costInput(workflow).maxCheckpointsPerTest, 4);
    const base = {root, workflow, checkpointLifetime: 'last-consumer'};
    const linear = await execute({...base, approach: 'L0', provider: new FixtureProvider()});
    const report = await execute({...base, provider: new FixtureProvider()});
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.results.map(r => r.state), linear.results.map(r => r.state));
    assert.equal(report.checkpointLimit.maxCheckpointsPerTest, 4);
    assert.equal(report.checkpoints.length, 4);
    assert.ok(report.checkpointLimit.warnings.some(w => w.candidates > 9 && w.limit === 4));
    assert.equal(report.releases.length, 4);
    assert.equal(fs.existsSync(report.directory), false);
    for (const limit of [0, -1, 1.5, '4', null, Infinity])
        assert.throws(() => new Graph({...deepWorkflow(), maxCheckpointsPerTest: limit}), /checkpoint.*limit/i);
});
function setup(t) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-costs-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const workflow=new Graph(fixtureWorkflow()),calls=[];
    const run=async(approach,options={})=>{const result=await execute({root,workflow,provider:new FixtureProvider(),approach,checkpointLifetime:'last-consumer',...options});calls.push({approach,options,result});return result;};
    return {root,workflow,run,calls};
}
const linear=()=>({schemaVersion:1,selected:[],basis:'ml-duration-estimate',reason:'linear-estimated-cheaper'});
test('AUTO is the default, plans once and does not create a calibration cache',async t=>{
    const input=setup(t);let solves=0;
    t.mock.method(costs,'solveCosts',units=>{solves++;assert.deepEqual(units,costInput(input.workflow));return linear();});
    for(let i=0;i<2;i++) {
        const report=await autoExecute({...input,provider:new FixtureProvider()});
        assert.equal(report.approach,'L0');assert.equal(report.checkpoints.length,0);
        assert.equal(report.checkpointPolicy.basis,'ml-duration-estimate');
    }
    assert.equal(solves,2);assert.deepEqual(fs.readdirSync(input.root),[]);
});
test('graph carries ML fixture and segment durations, and unknown is not zero',t=>{
    const {workflow}=setup(t);workflow.stages.get('baseline').estimatedMs=2;workflow.stages.get('cart-ready').estimatedMs=5;
    const input=costInput(workflow);assert.deepEqual(Object.keys(input).sort(),['baseline','maxCheckpointsPerTest','parents','stages']);
    assert.equal(input.maxCheckpointsPerTest,9);
    assert.equal(input.stages[0].estimatedMs,2);assert.equal(input.stages[1].estimatedMs,null);assert.equal(input.stages[2].estimatedMs,5);
    assert.equal(input.stages[2].parent,'customer-ready');assert.equal(input.parents.length,3);
});
test('AUTO selected composite preserves fixtures, intermediate work and results',async t=>{
    const input=setup(t);const baseline=await input.run('L0');
    t.mock.method(costs,'solveCosts',()=>({selected:['cart-ready'],reason:'static-estimated-saving'}));
    const report=await autoExecute({...input,provider:new FixtureProvider(),checkpointLifetime:'last-consumer'});
    assert.equal(report.status,'passed');assert.equal(report.checkpoints.length,1);assert.equal(report.checkpoints[0].stage,'cart-ready');
    assert.equal(report.counts.reuseHits,2);assert.equal(report.releases[0].after,'coupon-1');
    assert.ok(report.segments.some(s=>s.node==='customer-ready' && s.status==='passed'));
    assert.deepEqual(report.results.map(r=>r.state),baseline.results.map(r=>r.state));
});
test('public engine, Playwright library and CLI reject overrides before application access',async t=>{
    const {workflow,root}=setup(t), {main}=require('../branching/cli.cjs');
    const {runBranches}=require('../playwright/branching.cjs');
    t.mock.method(costs,'solveCosts',()=>assert.fail('Overrides must fail before planning'));
    for(const override of [{approach:'branching'},{approach:'L0'},{mode:'branching'},{mode:'CALIBRATE'},
        {checkpointSelection:[]},{checkpointSelection:['cart-ready']},{checkpointPolicy:{selected:['cart-ready']}},{solve:()=>({selected:[]})}]) {
        for(const run of [options=>autoExecute({...options,provider:new FixtureProvider()}),runBranches,
            options=>main({...options,state:async()=>({})},root)]) {
            await assert.rejects(run({workflow,root,...override}),/AUTO|Manual checkpoint/);
        }
    }
    assert.deepEqual(fs.readdirSync(root),[]);
});
test('opaque AUTO plans cannot be forged, mutated, reordered or lose consumers',async t=>{
    const {workflow,root}=setup(t);
    t.mock.method(costs,'solveCosts',()=>({selected:['cart-ready'],reason:'static-estimated-saving'}));
    const {plan,decision}=costs.planWorkflow(workflow);
    assert.throws(()=>decision.selected.push('baseline'),TypeError);
    const run=options=>autoExecute({workflow,root,provider:new FixtureProvider(),...options});
    await assert.rejects(run({plan:{decision}}),/Invalid or stale/);
    await assert.rejects(run({plan,specs:[...workflow.specs.keys()].reverse()}),/order changed/);
    await assert.rejects(run({plan,specs:[...workflow.specs.keys()].slice(1)}),/consumers/);
    workflow.stages.get('cart-ready').estimatedMs=100;
    await assert.rejects(run({plan}),/Invalid or stale/);
    assert.deepEqual(fs.readdirSync(root),[]);
});
test('failed selector does not launch a run or silently switch modes',async t=>{
    const input=setup(t);
    t.mock.method(costs,'solveCosts',()=>{throw new Error('invalid graph');});
    await assert.rejects(autoExecute({...input,provider:new FixtureProvider()}),/invalid graph/);
    assert.deepEqual(fs.readdirSync(input.root),[]);
});
test('automatic CLI accepts a prevalidated Graph before application checks',async t=>{
    const {workflow}=setup(t);const {main}=require('../branching/cli.cjs');
    await assert.rejects(main({workflow},'unused'),/must export state/);
});
