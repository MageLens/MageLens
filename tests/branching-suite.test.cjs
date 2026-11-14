// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const {assessed} = require('./fixtures/branching/assessment.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {fileDigest} = require('../branching/engine.cjs');
const costs = require('../branching/costs.cjs');
const {partition, validateNative, collectAssessed, runSuite} = require('../branching/suite.cjs');
function fixture(t) {
    t.mock.method(costs, 'solveCosts', () => ({selected:['shared']}));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-suite-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const file = path.join(root, 'flow.spec.ts'); fs.writeFileSync(file, 'await page.goto("/");');
    const tests = ['first', 'second'].map(id => ({id, file:'flow.spec.ts',line:1,title:id,scope:'same',disposition:'automatic',reasons:[],steps:[{start:0,end:21,kind:'statement',portable:true,estimatedMs:1}]}));
    const manifest = {schemaVersion:1,implementation:'rust-prefix-v1',root,sourceDigest:'test',sources:[{path:'flow.spec.ts',sha256:fileDigest(file)}],tests,schedule:tests.map(t=>t.id),
        diagnostics:[],checkpoints:[{id:'shared',depth:1,representative:'first',consumers:['first','second'],automatic:true}]};
    const setup = {id:'setup',project:'setup',file,line:2,title:'seed',expectedStatus:'passed'};
    const inventory = {exitCode:0,errors:[],config:{projects:[{name:'setup'},{name:'browser',dependencies:['setup']}]},tests:[setup,
        ...tests.map(t=>({...t,id:'native-'+t.id,project:'browser',file,expectedStatus:'passed'})),
        ...Array.from({length:100},(_,i)=>({id:'dynamic-'+i,title:'generated '+i,project:'browser',file,line:10,expectedStatus:'passed'}))]};
    // Every native test, including setup and the unbranched remainder, must be assessed.
    manifest.tests.push(...inventory.tests.filter(test => test.id === 'setup' || test.id.startsWith('dynamic-'))
        .map(test => ({...test, file: 'flow.spec.ts', scope: test.id, steps: [], disposition: 'adapter-required', reasons: ['Native lifecycle']})));
    manifest.schedule = manifest.tests.map(test => test.id);
    assessed(manifest);
    const project = {identity:'suite',state:async()=>({}),assertCheckpoint:async()=>{},native:{config:'config',splitSafe:true}};
    const calls = [];
    const runner = {collect:async()=>inventory, run:async(_config,_directory,options={})=>{
        const tests=options.tests??inventory.tests;calls.push({tests,options});
        return {tests,results:tests.map(t=>({id:t.id,status:'passed'})),status:'passed',exitCode:0,errors:[]};
    }};
    const runCheckpoint = async ({specs: ids, workflow, plan}) => {costs.resolvePlan(workflow, ids, plan);calls.push({checkpoint:ids});return {status:'passed',results:ids.map(spec=>({spec,status:'passed'})),checkpoints:[{id:'shared'}],counts:{reuseHits:1}};};
    return {root,manifest,inventory,project,runner,calls,runCheckpoint};
}
test('native inventory preserves every assessed generated and fixture-based test beyond the old subset',t=>{
    const f=fixture(t),g=partition(f.manifest,f.inventory,f.project);
    assert.equal(g.setup.length,1);assert.equal(g.checkpoint.length,2);assert.equal(g.native.length,100);
    assert.equal(new Set([...g.setup,...g.checkpoint,...g.native].map(t=>t.id)).size,103);
});
test('calibration can list a fully assessed suite before the model qualifies', async t => {
    const f = fixture(t);
    f.manifest.assessment.executionEligible = false;
    f.runner.run = () => assert.fail('Calibration discovery must not launch tests');
    await assert.rejects(runSuite({...f,directory:f.root}), error => error.issues?.[0]?.phase === 'qualification');
    const inventory = await collectAssessed(f.manifest,f.project,f.root,f.runner,{calibration:true});
    assert.equal(inventory.tests.length,103);
    fs.appendFileSync(path.join(f.root,'flow.spec.ts'),'\n');
    await assert.rejects(collectAssessed(f.manifest,f.project,f.root,f.runner,{calibration:true}), /Stale source/);
});
test('mixed suite runs native setup once, checkpoints, then every remaining native test',async t=>{
    const f=fixture(t); const report=await runSuite({...f,mode:'AUTO',directory:f.root});
    assert.equal(report.status,'passed');assert.equal(report.results.length,103);assert.equal(report.reuseHits,1);
    assert.equal(f.calls.length,3);assert.equal(f.calls[0].options.teardown,false);
    assert.deepEqual(f.calls[1].checkpoint,['first','second']);assert.equal(f.calls[2].options.setup,false);
    assert.deepEqual(report.missing,[]);assert.deepEqual(report.duplicates,[]);
});
test('suite records a frozen segment observation only with passing provider audits', async t => {
    const {SEGMENT_TIMING_BOUNDARY} = require('../branching/predictor/prefix-measurement.cjs');
    const f = fixture(t);
    const stage = f.manifest.assessment.stages.shared;
    stage.segment = {representative:'first',fromDepth:0,toDepth:1};
    stage.timingBoundary = SEGMENT_TIMING_BOUNDARY;
    stage.featureSchema = 'fixture';
    stage.environmentDigest = 'environment';
    stage.sourceDigest = f.manifest.sourceDigest;
    stage.trainingSnapshot = {unit:'prefix',timingBoundary:SEGMENT_TIMING_BOUNDARY,
        sourceDigest:f.manifest.sourceDigest,segment:stage.segment,prediction:stage.prediction};
    f.manifest.assessment.prefixTimingBoundary = SEGMENT_TIMING_BOUNDARY;
    for (const grantsRestored of [true,false]) {
        const report = await runSuite({...f,directory:f.root,runCheckpoint:async options=>{
            const result = await f.runCheckpoint(options);
            result.counts.fallbacks = 0;
            result.providerDiagnostics = {retainedServices:{schemasRemoved:true,grantsRestored}};
            result.segments = [{id:'segment',node:'shared',status:'passed',wallMs:12,prefixTiming:{
                timingBoundary:SEGMENT_TIMING_BOUNDARY,kind:'steps',fromDepth:0,toDepth:1,
                workCompleted:true,workMs:10,forecast:options.workflow.stages.get('shared').inputs.forecastIdentity
            }}];
            return result;
        }});
        const [evidence] = report.prefixEvidence;
        assert.ok(evidence.snapshotDigest);
        assert.equal(evidence.sourceVerified,true);
        assert.equal(evidence.providerAuditPassed,grantsRestored);
        assert.equal(evidence.observation.eligible,grantsRestored);
        assert.equal(evidence.observation.actualMs,10);
    }
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
    assessed(f.manifest);
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
test('independent Cypress tests match native titles without a synthetic setup project', async t => {
    const f = fixture(t), file = path.join(f.root, 'flow.spec.ts');
    fs.writeFileSync(file, 'cy.visit("/");');
    f.manifest.sources[0].sha256 = fileDigest(file);
    for (const item of f.manifest.tests) {
        item.fixture = 'cypress:it'; if (item.steps.length) item.steps[0].end = Buffer.byteLength('cy.visit("/");');
    }
    f.inventory.config = {projects: [{name: 'cypress'}], checkpointLifecycle: 'independent-cypress'};
    f.inventory.tests = f.inventory.tests.slice(1, 3).map(item => ({...item, project: 'cypress', framework: 'cypress', line: 0}));
    const checkpoint = f.runCheckpoint;
    f.runCheckpoint = async options => {
        assert.equal(options.runnerOptions.nativeConfig, f.project.native.config);
        return checkpoint(options);
    };
    const report = await runSuite({...f, directory: f.root});
    assert.equal(report.status, 'passed');
    assert.deepEqual(f.calls, [{checkpoint: ['first', 'second']}]);
    assert.equal(report.results.length, 2);
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
test('assessed teardown projects and unsplittable suites keep the complete native invocation',async t=>{
    for (const change of [f=>{f.project.native.splitSafe=false;}, f=>{f.inventory.config.projects[1].teardown='cleanup';},
        f=>{f.inventory.config.projects[1].dependencies=[];}, f=>{f.inventory.config.projects[0].dependencies=['another-setup'];}]) {
        const f=fixture(t);change(f);
        const report=await runSuite({...f,mode:'AUTO',directory:f.root});
        assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.tests,undefined);
        assert.deepEqual(report.routing.checkpoint,[]);assert.equal(report.routing.native.length,103);
    }
});
test('unassessed external runner lifecycle stops before native or checkpoint execution',async t=>{
    for (const config of [{globalSetup:true},{globalTeardown:true},{webServer:true},
        {unassessedLifecycle:['Cypress support-file hooks and command registrations']},
        {unassessedLifecycle:['Cypress setupNodeEvents and plugin lifecycle']}]) {
        const f=fixture(t);Object.assign(f.inventory.config,config);
        await assert.rejects(runSuite({...f,directory:f.root}),error=>error.statusCode===500&&error.issues.some(i=>i.phase==='native-lifecycle'));
        assert.equal(f.calls.length,0);
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
