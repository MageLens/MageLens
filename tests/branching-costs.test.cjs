// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Graph,execute}=require('../branching/engine.cjs');
const {orchestrate,costInput}=require('../branching/costs.cjs');
const {FixtureProvider,fixtureWorkflow}=require('./fixtures/branching/provider.cjs');
const {ActionMeter}=require('../branching/action-meter.cjs');
const {deepWorkflow}=require('./fixtures/branching/deep-workflow.cjs');

test('nine-checkpoint path limit preserves all actions, outcomes and cleanup for direct and explicit P0', async t => {
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
function setup(t) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-costs-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const workflow=new Graph(fixtureWorkflow()),calls=[];
    const run=async(approach,options={})=>{const result=await execute({root,workflow,provider:new FixtureProvider(),approach,checkpointLifetime:'last-consumer',...options});calls.push({approach,options,result});return result;};
    return {root,workflow,run,calls};
}
const linear=()=>({schemaVersion:1,selected:[],basis:'static-benchmark-estimate',reason:'linear-estimated-cheaper'});
test('AUTO runs once without calibration and does not create a cost cache',async t=>{
    const input=setup(t);let solves=0;
    for(let i=0;i<2;i++) {
        const r=await orchestrate({...input,mode:'AUTO',solve:units=>{solves++;assert.deepEqual(units,costInput(input.workflow));return linear();}});
        assert.equal(r.report.approach,'L0');assert.equal(r.report.checkpoints.length,0);
        assert.equal(r.report.checkpointPolicy.basis,'static-benchmark-estimate');
    }
    assert.equal(input.calls.length,2);assert.equal(solves,2);assert.deepEqual(fs.readdirSync(input.root),[]);
});
test('static graph carries fixture and incremental units, and unknown is not zero',t=>{
    const {workflow}=setup(t);workflow.stages.get('baseline').actionUnits=2;workflow.stages.get('cart-ready').actionUnits=5;
    const input=costInput(workflow);assert.deepEqual(Object.keys(input).sort(),['parents','stages']);
    assert.equal(input.stages[0].units,2);assert.equal(input.stages[1].units,null);assert.equal(input.stages[2].units,5);
    assert.equal(input.stages[2].parent,'customer-ready');assert.equal(input.parents.length,3);
});
test('selected composite preserves fixture, intermediate work and semantic results',async t=>{
    const input=setup(t);const baseline=await input.run('L0');
    const auto=await orchestrate({...input,mode:'AUTO',solve:()=>({selected:['cart-ready'],reason:'static-estimated-saving'})});
    assert.equal(auto.report.status,'passed');assert.equal(auto.report.checkpoints.length,1);assert.equal(auto.report.checkpoints[0].stage,'cart-ready');
    assert.equal(auto.report.counts.reuseHits,2);assert.equal(auto.report.releases[0].after,'coupon-1');
    assert.ok(auto.report.segments.some(s=>s.node==='customer-ready' && s.status==='passed'));
    assert.deepEqual(auto.report.results.map(r=>r.state),baseline.results.map(r=>r.state));
    assert.equal(input.calls.length,2);
});
test('forced L0 and P0 bypass static selection, calibration is not a runtime mode',async t=>{
    const input=setup(t);const solve=()=>{throw new Error('should not solve');};
    for(const mode of ['L0','P0'])assert.equal((await orchestrate({...input,mode,solve})).report.approach,mode);
    await assert.rejects(orchestrate({...input,mode:'CALIBRATE'}),/Unknown cost execution mode/);
    assert.equal(input.calls.length,2);
});
test('invalid checkpoint selection is rejected before backend preparation',async t=>{
    const input=setup(t);
    for(const selection of [['missing'],['baseline','baseline'],'baseline',null])await assert.rejects(input.run('P0',{checkpointSelection:selection}),/Invalid checkpoint selection/);
    assert.equal(input.calls.length,0);
});
test('failed selector does not launch a run or silently switch modes',async t=>{
    const input=setup(t);await assert.rejects(orchestrate({...input,mode:'AUTO',solve:()=>{throw new Error('invalid graph');}}),/invalid graph/);
    assert.equal(input.calls.length,0);
});
test('Playwright meter counts calls within a segment without recording arguments',()=>{
    const listeners=[];const meter=new ActionMeter({_instrumentation:{addListener:x=>listeners.push(x),removeListener:x=>listeners.splice(listeners.indexOf(x),1)}});
    const notify=(name,internal=false)=>listeners[0].onApiCallBegin({apiName:name,internal},{params:{password:'do not retain'}});
    notify('page.goto');meter.start();notify('page.goto');notify('locator.click');notify('internal',true);
    assert.deepEqual(meter.finish(),{total:2,byApi:{'page.goto':1,'locator.click':1}});
    notify('page.goto');assert.equal(meter.finish(),null);meter.close();assert.equal(listeners.length,0);
    const missing=new ActionMeter({});missing.start();assert.equal(missing.finish(),null);missing.close();
});
test('automatic CLI accepts a prevalidated Graph before application checks',async t=>{
    const {workflow}=setup(t);const {main}=require('../branching/cli.cjs');
    await assert.rejects(main(['unused','unused'],{workflow}),/must export state/);
});
