// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {fileDigest} = require('../branching/engine.cjs');
const costs = require('../branching/costs.cjs');
const {partition, validateNative, runSuite} = require('../branching/suite.cjs');
function fixture(t) {
    t.mock.method(costs, 'solveCosts', () => ({selected:['shared']}));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-suite-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const file = path.join(root, 'flow.spec.ts'); fs.writeFileSync(file, 'await page.goto("/");');
    const tests = ['first', 'second'].map(id => ({id, file:'flow.spec.ts',line:1,title:id,scope:'same',disposition:'automatic',reasons:[],steps:[{start:0,end:21,kind:'statement',portable:true,actionUnits:1}]}));
    const manifest = {schemaVersion:1,implementation:'rust-prefix-v1',root,sourceDigest:'test',sources:[{path:'flow.spec.ts',sha256:fileDigest(file)}],tests,schedule:tests.map(t=>t.id),
        diagnostics:['dynamic registration'],checkpoints:[{id:'shared',depth:1,representative:'first',consumers:['first','second'],automatic:true}]};
    const setup = {id:'setup',project:'setup',file,line:2,title:'seed',expectedStatus:'passed'};
    const inventory = {exitCode:0,errors:[],config:{projects:[{name:'setup'},{name:'browser',dependencies:['setup']}]},tests:[setup,
        ...tests.map(t=>({...t,id:'native-'+t.id,project:'browser',file,expectedStatus:'passed'})),
        ...Array.from({length:100},(_,i)=>({id:'dynamic-'+i,title:'generated '+i,project:'browser',file,line:10,expectedStatus:'passed'}))]};
    const project = {identity:'suite',state:async()=>({}),assertCheckpoint:async()=>{},native:{config:'config',splitSafe:true}};
    const calls = [];
    const runner = {collect:async()=>inventory, run:async(_config,_directory,options={})=>{
        const tests=options.tests??inventory.tests;calls.push({tests,options});
        return {tests,results:tests.map(t=>({id:t.id,status:'passed'})),status:'passed',exitCode:0,errors:[]};
    }};
    const runCheckpoint = async ({specs: ids, workflow, plan}) => {costs.resolvePlan(workflow, ids, plan);calls.push({checkpoint:ids});return {status:'passed',results:ids.map(spec=>({spec,status:'passed'})),checkpoints:[{id:'shared'}],counts:{reuseHits:1}};};
    return {root,manifest,inventory,project,runner,calls,runCheckpoint};
}
test('native inventory preserves every dynamic and fixture-based test beyond the old subset',t=>{
    const f=fixture(t),g=partition(f.manifest,f.inventory,f.project);
    assert.equal(g.setup.length,1);assert.equal(g.checkpoint.length,2);assert.equal(g.native.length,100);
    assert.equal(new Set([...g.setup,...g.checkpoint,...g.native].map(t=>t.id)).size,103);
});
test('mixed suite runs native setup once, checkpoints, then every remaining native test',async t=>{
    const f=fixture(t); const report=await runSuite({...f,mode:'AUTO',directory:f.root});
    assert.equal(report.status,'passed');assert.equal(report.results.length,103);assert.equal(report.reuseHits,1);
    assert.equal(f.calls.length,3);assert.equal(f.calls[0].options.teardown,false);
    assert.deepEqual(f.calls[1].checkpoint,['first','second']);assert.equal(f.calls[2].options.setup,false);
    assert.deepEqual(report.missing,[]);assert.deepEqual(report.duplicates,[]);
});
test('checkpoint execution preserves the order costed by Rust when native inventory differs',async t=>{
    const f=fixture(t);f.inventory.tests.reverse();
    const report=await runSuite({...f,directory:f.root});
    assert.equal(report.status,'passed');assert.deepEqual(f.calls[1].checkpoint,['first','second']);
});
test('unprofitable AUTO retains one complete original native invocation',async t=>{
    const f=fixture(t);t.mock.method(costs,'solveCosts',()=>({selected:[]}));
    const report=await runSuite({...f,directory:f.root});
    assert.equal(report.mode,'AUTO');assert.equal(report.status,'passed');assert.equal(report.checkpoints,0);assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].options.tests,undefined);assert.equal(report.results.length,103);
});
test('suite rejects non-AUTO modes and manual configuration before discovery',async t=>{
    for(const options of [{mode:'branching'},{mode:'L0'},{checkpointSelection:['shared']},{solve:()=>({selected:['shared']})}]) {
        const f=fixture(t);f.runner.collect=()=>assert.fail('must reject before discovery');
        await assert.rejects(runSuite({...f,...options,directory:f.root}),/AUTO|Manual checkpoint/);
    }
    const f=fixture(t);f.project.checkpointSelection=['shared'];f.runner.collect=()=>assert.fail('must reject configuration override');
    await assert.rejects(runSuite({...f,directory:f.root}),/Manual checkpoint/);
});
test('a project checkpoint budget is validated even if every test would remain native',async t=>{
    const f=fixture(t);f.project.maxCheckpointsPerTest=0;
    f.runner.collect=()=>assert.fail('invalid budget must fail before discovery');
    await assert.rejects(runSuite({...f,directory:f.root}),/Checkpoint limit/);
});
test('AUTO leaves unrelated cheap candidates native while branching profitable shared work', async t => {
    const f=fixture(t);
    for(const id of ['cheap-first','cheap-second']) {
        const item={...f.manifest.tests[0],id,title:id,scope:'cheap'};
        f.manifest.tests.push(item);f.manifest.schedule.push(id);
        f.inventory.tests.push({...item,id:'native-'+id,project:'browser',file:path.join(f.root,item.file),expectedStatus:'passed'});
    }
    f.manifest.checkpoints.push({id:'cheap',depth:1,representative:'cheap-first',consumers:['cheap-first','cheap-second'],automatic:true});
    const report=await runSuite({...f,mode:'AUTO',directory:f.root});
    assert.equal(report.status,'passed');assert.deepEqual(f.calls[1].checkpoint,['first','second']);
    assert.ok(f.calls[2].tests.some(test=>test.id==='native-cheap-first'));
    assert.ok(f.calls[2].tests.some(test=>test.id==='native-cheap-second'));
    assert.equal(report.results.length,105);
});
test('a fully checkpoint-eligible suite needs no artificial native remainder', async t => {
    const f=fixture(t);f.inventory.tests=f.inventory.tests.slice(0,3);
    const report=await runSuite({...f,mode:'AUTO',directory:f.root});
    assert.equal(report.status,'passed');assert.equal(f.calls.length,2);
    assert.equal(report.results.length,3);assert.equal(report.checkpoints,1);
});
test('ambiguous static matches across browser projects and skipped tests stay native',t=>{
    const f=fixture(t); f.inventory.tests.push({...f.inventory.tests[1],id:'other-browser',project:'other'});
    f.inventory.tests[2].expectedStatus='skipped';
    assert.equal(partition(f.manifest,f.inventory,f.project).checkpoint.length,0);
});
test('native selection rejects extra/missing/duplicate tests and incomplete success',()=>{
    const expected=[{id:'a'}],good={tests:expected,results:[{id:'a',status:'passed'}],status:'passed',exitCode:0};
    assert.doesNotThrow(()=>validateNative(good,expected));
    for(const tests of [[],[{id:'b'}],[{id:'a'},{id:'a'}]])assert.throws(()=>validateNative({...good,tests},expected),/selection changed/);
    assert.throws(()=>validateNative({...good,results:[]},expected),/incomplete/);
    assert.throws(()=>validateNative({...good,results:[{id:'a'},{id:'a'}]},expected),/Duplicate/);
});
test('setup failure prevents checkpoints and records the blocked remainder',async t=>{
    const f=fixture(t);f.runner.run=async(_c,_d,{tests})=>({tests,results:tests.map(t=>({id:t.id,status:'failed'})),status:'failed',exitCode:1,errors:[]});
    f.runCheckpoint=()=>assert.fail('Failed setup must not reach checkpoint worker');
    const report=await runSuite({...f,mode:'AUTO',directory:f.root});assert.equal(report.status,'failed');assert.equal(report.missing.length,102);
});
test('native skips remain visible and never become a fully passed qualification',async t=>{
    const f=fixture(t);t.mock.method(costs,'solveCosts',()=>({selected:[]}));f.runner.run=async()=>({tests:f.inventory.tests,results:f.inventory.tests.map(t=>({id:t.id,status:t.id==='setup'?'passed':'skipped'})),status:'passed',exitCode:0,errors:[]});
    const report=await runSuite({...f,mode:'AUTO',directory:f.root});assert.equal(report.status,'completed-with-skips');assert.equal(report.skipped.length,102);
});
test('unqualified global lifecycle or teardown projects keep the complete native invocation',async t=>{
    for (const change of [f=>{f.project.native.splitSafe=false;}, f=>{f.inventory.config.globalTeardown=true;},
        f=>{f.inventory.config.webServer=true;}, f=>{f.inventory.config.projects[1].teardown='cleanup';},
        f=>{f.inventory.config.projects[1].dependencies=[];}, f=>{f.inventory.config.projects[0].dependencies=['another-setup'];}]) {
        const f=fixture(t);change(f);
        const report=await runSuite({...f,mode:'AUTO',directory:f.root});
        assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.tests,undefined);
        assert.deepEqual(report.routing.checkpoint,[]);assert.equal(report.routing.native.length,103);
    }
});
test('expected failures remain visible instead of qualifying as passed',async t=>{
    const f=fixture(t);t.mock.method(costs,'solveCosts',()=>({selected:[]}));f.runner.run=async()=>({tests:f.inventory.tests,results:f.inventory.tests.map(t=>({id:t.id,status:t.id==='setup'?'passed':'failed',expectedStatus:'failed'})),status:'passed',exitCode:0,errors:[]});
    const report=await runSuite({...f,mode:'AUTO',directory:f.root});assert.equal(report.status,'failed');
});
test('one suite lease fences native collection, checkpoint transitions and recovery',t=>{
    const f=fixture(t), leases=require('../branching/workflow-lease.cjs');
    fs.mkdirSync(path.join(f.root,'.runtime'));
    const lease=leases.acquire(f.root);
    assert.throws(()=>leases.acquire(f.root),/EEXIST/);
    assert.throws(()=>leases.join(lease.lock,{...lease,token:'someone else'}),/does not own/);
    assert.doesNotThrow(()=>leases.join(lease.lock,lease));
    fs.writeFileSync(path.join(lease.lock,'branching.json'),'{}');
    assert.equal(leases.release(lease),false,'checkpoint recovery must keep the suite lock');
    fs.unlinkSync(path.join(lease.lock,'branching.json'));
    fs.writeFileSync(path.join(f.root,'.runtime/branching-recovery.json'),'{}');
    assert.equal(leases.release(lease),false);
    fs.unlinkSync(path.join(f.root,'.runtime/branching-recovery.json'));
    assert.equal(leases.release(lease),true);
    assert.equal(fs.existsSync(lease.lock),false);
});
