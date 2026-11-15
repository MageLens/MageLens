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
const {partition, validateNative, collectAssessed, runSuite, playwrightCoverageResult} = require('../branching/suite.cjs');
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
test('one suite journal includes native setup, all native tests and real checkpoint execution', async t => {
    const f=fixture(t), events=[];
    f.project.expect=assert;
    const {FixtureProvider}=require('./fixtures/branching/provider.cjs');
    class Provider extends FixtureProvider { get page() { return {goto:async url=>{this.state.browser.url=url;}}; } }
    const report=await runSuite({...f,directory:f.root,onEvent:event=>events.push(event),
        runCheckpoint:options=>require('../branching/engine.cjs').execute({...options,root:path.join(f.root,'storage'),provider:new Provider()})});
    const state=events.reduce(require('../branching/dashboard/model.cjs').applyEvent,null);
    assert.equal(report.status,'passed',JSON.stringify(report.phases.filter(p=>p.kind==='checkpoint').map(p=>p.report.errors))); assert.equal(state.status,'passed');
    assert.equal(events.filter(e=>e.type==='run-start').length,1);
    assert.equal(events.filter(e=>e.type==='run-end').length,1);
    assert.equal(events[0].nodes.length,0);
    assert.equal(state.nodes.filter(n=>n.kind==='test' && n.status==='passed').length,103);
    assert.deepEqual(state.schedule,report.ordering.scheduled);
    assert.equal(state.counts.prefixExecutions,4);
    assert.equal(state.nodes.filter(n=>n.kind==='checkpoint').length,1);
    assert.ok(state.baseline.observations.length>0);
    assert.equal(state.counts.reuseHits,0);
});
test('native inventory preserves every assessed generated and fixture-based test beyond the old subset',t=>{
    const f=fixture(t),g=partition(f.manifest,f.inventory,f.project);
    assert.equal(g.setup.length,1);assert.equal(g.checkpoint.length,2);assert.equal(g.native.length,100);
    assert.equal(new Set([...g.setup,...g.checkpoint,...g.native].map(t=>t.id)).size,103);
});
test('mixed Playwright coverage reports the original inventory and rejects incomplete or mismatched evidence', async t => {
    const f = fixture(t);
    const version = '157.0.8103.38';
    const {browserProfile} = require('../branching/runners/playwright/native-reporter.cjs');
    const use = {channel: 'chrome', baseURL: process.env.PLAYWRIGHT_BASE_URL, ignoreHTTPSErrors: true, serviceWorkers: 'block'};
    f.inventory.config.projects[1].browserProfile = browserProfile(use);
    assert.notEqual(browserProfile({...use, viewport: {width: 900, height: 700}}).digest, browserProfile(use).digest);
    assert.notEqual(browserProfile({...use, serviceWorkers: 'allow'}).digest, browserProfile(use).digest);
    assert.equal(browserProfile({...use, proxy: {server: 'http://localhost:8080'}}).portable, false);
    const annotation = {type: 'magelens-browser', description: JSON.stringify({name: 'chrome', version})};
    const run = f.runner.run;
    f.runner.run = async (...args) => {
        const phase = await run(...args);
        for (const result of phase.results) Object.assign(result, {attempts: 1, annotations: [annotation]});
        return phase;
    };
    const report = await runSuite({...f, directory: f.root, coverageRoot: f.root, runCheckpoint: async options => {
        const phase = await f.runCheckpoint(options);
        phase.browser = {name: 'Chrome for Testing', version};
        phase.counts.fallbacks = 0;
        return phase;
    }});
    const runId = 'a'.repeat(32);
    const coverage = playwrightCoverageResult(report, runId, version);
    assert.equal(coverage.run, runId);
    assert.equal(coverage.totalPassed, 103);
    assert.equal(f.calls.filter(call => call.options?.coverageRoot === f.root).length, 2);
    assert.deepEqual(coverage.tests.map(test => test.title), report.inventory.map(test => test.title));
    assert.throws(() => playwrightCoverageResult(report, runId, 'other'), /browser/);
    assert.throws(() => playwrightCoverageResult({...report, results: report.results.slice(1)}, runId, version), /complete/);
    report.phases.find(phase => phase.kind === 'checkpoint').report.counts.fallbacks = 1;
    assert.throws(() => playwrightCoverageResult(report, runId, version), /restore evidence/);
});
test('incompatible browser settings keep the complete suite native and report the rejected routes', async t => {
    const f = fixture(t);
    const coverageRoot = f.root;
    const {browserProfile} = require('../branching/runners/playwright/native-reporter.cjs');
    f.inventory.config.projects[1].browserProfile = browserProfile({channel: 'chrome', viewport: {width: 900, height: 700}});
    const report = await runSuite({...f, directory: f.root, coverageRoot});
    assert.equal(report.status, 'passed');
    assert.equal(report.routing.checkpoint.length, 0);
    assert.equal(report.routing.native.length, 103);
    assert.deepEqual(report.routing.browserIneligible, ['native-first', 'native-second'].map(id =>
        ({id, reason: 'incompatible-playwright-browser-settings'})));
});
test('discovery does not require timing estimates but rejects changed source', async t => {
    const f = fixture(t);
    const inventory = await collectAssessed(f.manifest,f.project,f.root,f.runner);
    assert.equal(inventory.tests.length,103);
    fs.appendFileSync(path.join(f.root,'flow.spec.ts'),'\n');
    await assert.rejects(collectAssessed(f.manifest,f.project,f.root,f.runner), /Stale source/);
});
test('old ML manifests fail before loading the project with a migration message', async t => {
    const f = fixture(t);
    f.manifest.assessment.version = 'ml-duration-v1';
    const file = path.join(f.root, 'manifest.json');
    fs.writeFileSync(file, JSON.stringify(f.manifest));
    await assert.rejects(require('../branching/auto-cli.cjs').run([file, 'missing.cjs', f.root]),
        error => error.issues?.some(issue => /ML manifests are no longer supported/.test(issue.message)));
});
test('mixed suite runs native setup once, checkpoints, then every remaining native test',async t=>{
    const f=fixture(t); const report=await runSuite({...f,mode:'AUTO',directory:f.root});
    assert.equal(report.status,'passed');assert.equal(report.results.length,103);assert.equal(report.reuseHits,1);
    assert.equal(f.calls.length,3);assert.equal(f.calls[0].options.teardown,false);
    assert.deepEqual(f.calls[1].checkpoint,['first','second']);assert.equal(f.calls[2].options.setup,false);
    assert.deepEqual(report.missing,[]);assert.deepEqual(report.duplicates,[]);
});
test('checkpoint routing never crosses native tests when collection order differs',async t=>{
    const f=fixture(t);f.inventory.tests.reverse();
    const report=await runSuite({...f,directory:f.root});
    assert.equal(report.status,'passed');assert.equal(f.calls.length,3);assert.equal(f.calls[1].tests.length,100);assert.deepEqual(f.calls[2].checkpoint,['second','first']);
});
test('unprofitable AUTO retains one complete original native invocation',async t=>{
    const f=fixture(t);f.manifest.checkpoints=[];
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
test('serial groups remain in one untouched native invocation', async t => {
    const f=fixture(t); f.inventory.tests[1].serial=true;
    const report=await runSuite({...f,directory:f.root});
    assert.equal(report.status,'passed'); assert.equal(report.checkpoints,0);
    assert.equal(f.calls.length,1); assert.equal(f.calls[0].options.tests,undefined);
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
    const f=fixture(t);f.manifest.checkpoints=[];f.runner.run=async()=>({tests:f.inventory.tests,results:f.inventory.tests.map(t=>({id:t.id,status:t.id==='setup'?'passed':'skipped'})),status:'passed',exitCode:0,errors:[]});
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
    const f=fixture(t);f.manifest.checkpoints=[];f.runner.run=async()=>({tests:f.inventory.tests,results:f.inventory.tests.map(t=>({id:t.id,status:t.id==='setup'?'passed':'failed',expectedStatus:'failed'})),status:'passed',exitCode:0,errors:[]});
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

test('independent single-project Playwright suite uses measured candidates without synthetic setup', async t => {
    const f = fixture(t);
    f.inventory.tests = f.inventory.tests.slice(1,3);
    f.inventory.config.projects = [{name:'browser', dependencies:[]}];
    const report = await runSuite({...f, directory:f.root});
    assert.equal(report.status, 'passed');
    assert.deepEqual(f.calls, [{checkpoint:['first','second']}]);
    assert.equal(report.results.length,2);
});

test('declared parallel page tests group consumers without crossing setup or rerunning hooks', async t => {
    const f=fixture(t);
    f.inventory.tests=f.inventory.tests.slice(0,3);
    const source={...f.manifest.tests[0],id:'middle',title:'middle',fixtureSetup:[]};
    f.manifest.tests.push(source);
    f.inventory.tests.splice(2,0,{...f.inventory.tests[1],id:'native-middle',title:'middle'});
    f.inventory.config.projects[1].fullyParallel=true;
    const report=await runSuite({...f,directory:f.root});
    assert.equal(report.status,'passed');
    assert.deepEqual(report.ordering.scheduled,['setup','native-middle','native-first','native-second']);
    assert.equal(report.ordering.changed,true);
    assert.deepEqual(f.calls.map(call=>call.checkpoint??call.tests.map(test=>test.id)),[['setup'],['native-middle'],['first','second']]);
    assert.deepEqual(report.results.map(result=>result.id),report.ordering.scheduled);
});
test('independent interleaved prefix groups become contiguous while setup stays first', async t => {
    const f=fixture(t);
    const extra=['third','fourth'].map(id=>({...f.manifest.tests[0],id,title:id,scope:'another'}));
    f.manifest.tests.push(...extra);
    f.manifest.checkpoints.push({...f.manifest.checkpoints[0],id:'another-shared',representative:'third',consumers:['third','fourth']});
    f.manifest.schedule.push('third','fourth');
    const native=extra.map(source=>({...f.inventory.tests[1],id:'native-'+source.id,title:source.title}));
    f.inventory.tests=[f.inventory.tests[0],f.inventory.tests[1],native[0],f.inventory.tests[2],native[1]];
    f.inventory.config.projects[1].fullyParallel=true;
    const report=await runSuite({...f,directory:f.root});
    assert.equal(report.status,'passed');
    assert.deepEqual(report.ordering.scheduled,['setup','native-first','native-second','native-third','native-fourth']);
    assert.equal(report.counts.candidates,2);
    assert.deepEqual(report.results.map(result=>result.id),report.ordering.scheduled);
    assert.deepEqual(f.calls.map(call=>call.checkpoint??call.tests.map(test=>test.id)),[['setup'],['first','second','third','fourth']]);
});
test('parallel configuration cannot reorder fixture setup or native-only lifecycle work', async t => {
    const f=fixture(t); f.inventory.config.projects[1].fullyParallel=true;
    f.inventory.tests.splice(2,0,f.inventory.tests.pop());
    const report=await runSuite({...f,directory:f.root});
    assert.equal(report.ordering.changed,false);
    assert.deepEqual(report.results.map(result=>result.id),f.inventory.tests.map(test=>test.id));
});

test('declared parallel fixture consumers retain source order', async t => {
    const f=fixture(t);
    f.inventory.tests=f.inventory.tests.slice(0,3);
    const source={...f.manifest.tests[0],id:'middle',title:'middle',fixtureSetup:[]};
    f.manifest.tests.push(source);
    f.manifest.tests[0].fixtureSetup=[{name:'shared-resource'}];
    f.inventory.tests.splice(2,0,{...f.inventory.tests[1],id:'native-middle',title:'middle'});
    f.inventory.config.projects[1].fullyParallel=true;
    const report=await runSuite({...f,directory:f.root});
    assert.equal(report.status,'passed');
    assert.equal(report.ordering.changed,false);
    assert.deepEqual(report.results.map(result=>result.id),f.inventory.tests.map(test=>test.id));
});

test('verified independent native locals can move as a whole test without becoming checkpoint consumers', async t => {
    const f=fixture(t);
    f.inventory.tests=f.inventory.tests.slice(0,3);
    const source={...f.manifest.tests[0],id:'middle',title:'middle',disposition:'adapter-required',fixtureSetup:[]};
    f.manifest.tests.push(source);
    f.inventory.tests.splice(2,0,{...f.inventory.tests[1],id:'native-middle',title:'middle'});
    f.inventory.config.projects[1].fullyParallel=true;
    f.project.adapter={identity:'verified-page-lifecycle',supports:test=>test.id!=='middle',supportsOrdering:()=>true,
        supportsCheckpoint:()=>true,execute:()=>{}};
    const report=await runSuite({...f,directory:f.root});
    assert.equal(report.status,'passed');
    assert.equal(report.ordering.changed,true);
    assert.deepEqual(report.routing.native,['setup','native-middle']);
    assert.deepEqual(report.results.map(result=>result.id),['setup','native-middle','native-first','native-second']);
});
