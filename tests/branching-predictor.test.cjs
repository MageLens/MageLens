// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const p = require('../branching/predictor/index.cjs');
const request = () => ({runner:'playwright', unit:'suite-tests', sources:[{name:'test.ts', source:'const result = [1,2,3].map(x => x * 2);'}],
    environment:{browser:'pinned', workers:1}, sourceFamily:'test-suite', group:'workload', baselineMs:200, manualMultiplier:1});
function model(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-predictor-'));
    t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
    const file = path.join(directory, 'model.json');
    fs.writeFileSync(file, JSON.stringify({schemaVersion:1, featureSchema:p.FEATURE_SCHEMA, qualified:false, referenceBaselineMs:100,
        estimator:{intercept:Math.log1p(100), coefficients:Array(p.WIDTH).fill(0), mean:Array(p.WIDTH).fill(0), scale:Array(p.WIDTH).fill(1)},
        errorLogP90:.1, domains:[{runner:'playwright', unit:'suite-tests', environmentDigest:'training-host', ranges:Array(p.WIDTH).fill([0, 1000000])}]}));
    return {file, directory, loaded:p.loadModel(file)};
}
test('syntax features never execute project JavaScript and do not need per-statement interpretation', () => {
    const input=request();input.sources[0].source='globalThis.predictorExecuted = true; class X { async *run() { yield await Promise.resolve(1); } }';
    const first=p.features(input);assert.equal(globalThis.predictorExecuted,undefined);
    assert.equal(first.vector.length,p.WIDTH);assert.ok(first.vector.every(Number.isFinite));
    assert.deepEqual(p.features(input),first);
    assert.throws(()=>p.features({...input,sources:[{name:'bad.js',source:'const ='}]}),e=>e.statusCode===500);
});
test('baseline ratio and manual adjustment are fixed before running, including faster environments', t => {
    const {loaded}=model(t), input=request(), frozen=p.prepare(input,loaded);
    assert.ok(Math.abs(frozen.prediction.rawMs-100)<1e-9);assert.ok(Math.abs(frozen.prediction.ms-200)<1e-9);
    input.baselineMs=50;input.manualMultiplier=.8;
    assert.ok(Math.abs(p.prepare(input,loaded).prediction.ms-40)<1e-9);
    assert.equal(frozen.baselineMs,200);
    assert.throws(()=>p.predict(frozen,loaded),e=>e.statusCode===500 && /qualification/.test(e.issues[0].message));
    for(const baselineMs of [0,-1,NaN,Infinity]) assert.equal(p.prepare({...input,baselineMs},loaded).predictionError.statusCode,500);
});
test('model identity, timing boundary and feature range cannot silently change', t => {
    const {loaded,file}=model(t),snapshot=p.prepare(request(),loaded);
    assert.throws(()=>p.loadModel(file,'0'.repeat(64)),e=>e.statusCode===500);
    assert.throws(()=>p.predict({...snapshot,unit:'prefix'},loaded,{shadow:true}),e=>e.statusCode===500);
    const huge={...snapshot,vector:snapshot.vector.map(x=>x+1000001)};
    assert.equal(p.predict(huge,loaded,{shadow:true}).outOfRange,true);
    fs.writeFileSync(file,'invalid');assert.throws(()=>p.loadModel(file),e=>e.statusCode===500);
});
test('frozen model input transforms agree with log-count training and preserve legacy models', t => {
    const {loaded,file}=model(t), snapshot=p.prepare(request(),loaded);
    loaded.model.estimator.inputTransform='log1p';
    loaded.model.estimator.coefficients[3]=1;
    const expected=Math.expm1(Math.log1p(100)+Math.log1p(snapshot.vector[3]));
    assert.ok(Math.abs(p.predict(snapshot,loaded,{shadow:true}).rawMs-expected)<1e-6);
    assert.throws(()=>p.predict({...snapshot,vector:snapshot.vector.map(x=>-x-1)},loaded,{shadow:true}),e=>e.statusCode===500);
    loaded.model.estimator.inputTransform='unknown';
    fs.writeFileSync(file,JSON.stringify(loaded.model));
    assert.throws(()=>p.loadModel(file),e=>e.statusCode===500);
});
test('failed, retried or changed-source runs are quarantined instead of training labels', t => {
    const {loaded}=model(t),snapshot=p.prepare(request(),loaded),valid={passed:true,sourceDigest:snapshot.sourceDigest};
    const sample=p.observe(snapshot,200,valid);assert.equal(sample.eligible,true);
    for(const patch of [{passed:false},{attempts:2},{sourceDigest:'changed'}]) assert.equal(p.observe(snapshot,200,{...valid,...patch}).eligible,false);
    assert.throws(()=>p.observe(snapshot,0,valid),e=>e.statusCode===500);
    assert.equal(snapshot.actualMs,undefined);
});
test('separate observations of identical parameterized callbacks have distinct preserved identities', () => {
    const first=p.prepare(request(),null), second=p.prepare(request(),null);
    assert.equal(first.sourceDigest,second.sourceDigest);
    assert.notEqual(first.observationId,second.observationId);
    assert.equal(p.observe(first,100,{passed:true,sourceDigest:first.sourceDigest}).observationId,first.observationId);
});
test('evaluation compares raw and pre-run scaled predictions without changing saved model or baseline', t => {
    const {loaded}=model(t),before=JSON.stringify(loaded),snapshot=p.prepare(request(),loaded);
    const sample=p.observe(snapshot,200,{passed:true,sourceDigest:snapshot.sourceDigest});
    const result=p.evaluate([sample]);
    assert.equal(result.status,'scored');assert.ok(result.p90AbsolutePercentError<1e-9);
    assert.ok(Math.abs(result.raw.p90AbsolutePercentError-50)<1e-9);
    assert.equal(result.checkpointDecisions.status,'unmeasured');assert.equal(JSON.stringify(loaded),before);
    const missing=p.prepare(request(),null);
    assert.equal(p.evaluate([p.observe(missing,200,{passed:true,sourceDigest:missing.sourceDigest})]).unpredicted,1);
});
test('numeric extension features are project agnostic and reject invalid input', () => {
    const base=p.features(request());
    const extended=p.features({...request(),extraFeatures:{'fixture.items':40}});
    assert.notDeepEqual(extended.vector,base.vector);assert.equal(extended.sourceDigest,base.sourceDigest);
    assert.throws(()=>p.features({...request(),extraFeatures:{'fixture.items':-1}}),e=>e.statusCode===500);
});
test('work and supporting code have independent feature channels and fingerprints', () => {
    const input={...request(),sources:[{name:'callback.js',source:'const work = () => visit();',role:'work'},
        {name:'helpers.js',source:'export function visit() {}',role:'context'}]};
    const original=p.features(input);
    input.sources[1].source+='\nexport function unrelated() { return [1,2,3]; }';
    const changed=p.features(input);
    assert.deepEqual(original.vector.slice(0,72),changed.vector.slice(0,72));
    assert.notDeepEqual(original.vector.slice(72),changed.vector.slice(72));
    input.sources[1].role='work';
    assert.notEqual(p.features(input).sourceDigest,changed.sourceDigest);
    assert.throws(()=>p.features({...input,sources:input.sources.map(s=>({...s,role:'context'}))}),e=>e.statusCode===500);
    assert.throws(()=>p.features({...input,sources:[{...input.sources[0],role:'unknown'}]}),e=>e.statusCode===500);
});
test('older frozen model schemas retain the original count extraction and width', t => {
    const {file,loaded}=model(t), legacy=loaded.model;
    legacy.featureSchema='syntax-hash-v2-babel-7.29.9';
    for(const key of ['mean','scale','coefficients'])legacy.estimator[key]=legacy.estimator[key].slice(0,72);
    for(const domain of legacy.domains)domain.ranges=domain.ranges.slice(0,72);
    fs.writeFileSync(file,JSON.stringify(legacy));
    const snapshot=p.prepare(request(),p.loadModel(file));
    assert.equal(snapshot.vector.length,72);assert.equal(snapshot.featureSchema,legacy.featureSchema);
    assert.deepEqual(snapshot.vector,p.features({...request(),featureSchema:legacy.featureSchema}).vector);
    assert.ok(snapshot.prediction && snapshot.prediction.ms>0);
});
test('CLI source roles use paths relative to the request and keep string entries compatible', t => {
    const {directory}=model(t), cli=require('../branching/predictor/cli.cjs');
    fs.writeFileSync(path.join(directory,'work.ts'),'const work = () => helper();');
    fs.writeFileSync(path.join(directory,'helpers.ts'),'export function helper() { return 42; }');
    const input=path.join(directory,'request.json'), output=path.join(directory,'snapshot.json');
    fs.writeFileSync(input,JSON.stringify({...request(),files:['work.ts',{path:'helpers.ts',role:'context'}]}));
    cli.main(['prepare',input,output]);
    const snapshot=JSON.parse(fs.readFileSync(output));
    assert.equal(snapshot.featureSchema,p.FEATURE_SCHEMA);
    assert.ok(snapshot.vector[3]>0);assert.ok(snapshot.vector[72+3]>0);
    assert.equal(snapshot.predictionError.code,'ESTIMATION_FAILED');
});

test('explicit training archives immutable inputs for extraction without rerunning tests', t => {
    const {directory}=model(t),input={...request(),sourceStore:path.join(directory,'sources'),extraFeatures:{'fixture.items':2}};
    const snapshot=p.prepare(input,null),archive=snapshot.sourceArchive[0];
    assert.equal(fs.readFileSync(path.join(input.sourceStore,archive.sha256),'utf8'),input.sources[0].source);
    input.extraFeatures['fixture.items']=9;
    assert.equal(snapshot.extraFeatures['fixture.items'],2);
    const archivedPath = path.join(input.sourceStore,archive.sha256);
    const linked = path.join(directory,'linked-source');
    fs.renameSync(archivedPath,linked);
    fs.symlinkSync(linked,archivedPath);
    assert.throws(()=>p.prepare(input,null),error=>error.code==='ELOOP');
    fs.unlinkSync(archivedPath);
    fs.renameSync(linked,archivedPath);
    fs.writeFileSync(path.join(input.sourceStore,archive.sha256),'changed');
    assert.throws(()=>p.prepare(input,null),e=>e.statusCode===500);
    assert.equal(p.prepare(request(),null).sourceArchive,undefined);
});

test('shared-source feature caching preserves numeric maxima and isolates returned vectors', () => {
    const input={...request(),sources:[{name:'first.ts',source:'const maximum = 9000;'},
        {name:'helper.ts',source:'export const items = [2,3];'}]};
    const first=p.features(input), expected=structuredClone(first);
    first.vector.fill(-1);
    assert.deepEqual(p.features(input),expected);
    assert.equal(expected.vector[7],Math.log1p(9000));
    input.sources[1].source='export const items = [90000];';
    const changed=p.features(input);
    assert.equal(changed.vector[7],Math.log1p(90000));
    assert.notEqual(changed.sourceDigest,expected.sourceDigest);
});

test('native profiling freezes per-test inputs before results and quarantines invalid observations', t => {
    const {directory}=model(t), native=require('../branching/predictor/native.cjs');
    const file=path.join(directory,'journey.cy.js');
    fs.writeFileSync(file,'describe("journey", () => { it("works", () => cy.visit("/")); });');
    const collect=native.collector({sourceFamily:'fixture',baselineMs:100,environment:{browser:'pinned'}},directory,directory);
    const tests=['passed','failed','retried','missing','skipped'].map(id=>({id,titlePath:['journey',id],
        timingSource:'() => cy.visit("/")',expectedStatus:id==='skipped'?'skipped':'passed'}));
    collect({file,tests,hooks:[{scope:['journey'],source:'() => cy.clearCookies()'},
        {scope:['unrelated'],source:'invalid JavaScript that must never be parsed'}]});
    const before=fs.readFileSync(path.join(directory,'predictions.json'),'utf8');
    assert.equal(JSON.parse(before).length,4);
    const report={results:[{id:'passed',durationMs:200,status:'passed',attempts:1,errors:[]},
        {id:'failed',durationMs:200,status:'failed',attempts:1,errors:[{message:'failed'}]},
        {id:'retried',durationMs:200,status:'passed',attempts:2,errors:[]}]};
    native.finish(directory,report);
    const samples=JSON.parse(fs.readFileSync(path.join(directory,'prediction-samples.json')));
    assert.deepEqual(samples.map(sample=>sample.eligible),[true,false,false,false]);
    assert.equal(fs.readFileSync(path.join(directory,'predictions.json'),'utf8'),before);
    fs.appendFileSync(file,'\n// changed after prediction');
    native.finish(directory,report);
    assert.ok(JSON.parse(fs.readFileSync(path.join(directory,'prediction-samples.json'))).every(sample=>!sample.eligible));
});

test('related generated files share an explicit validation group', t => {
    const {directory}=model(t), native=require('../branching/predictor/native.cjs');
    const collect=native.collector({sourceFamily:'generator',group:'related-workload',baselineMs:100,environment:{browser:'pinned'}},directory,directory);
    for(const name of ['setup.js','journey.js']) {
        const file=path.join(directory,name);fs.writeFileSync(file,'const work = () => {};');
        collect({file,hooks:[],tests:[{id:name,titlePath:[],timingSource:'() => {}'}]});
    }
    const rows=JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    assert.equal(rows.length,2);assert.equal(rows[0].snapshot.group,rows[1].snapshot.group);
    assert.notEqual(rows[0].snapshot.observationId,rows[1].snapshot.observationId);
});

test('native profiling attributes once-only hooks to the first and last runnable tests in their scope', t => {
    const {directory}=model(t), native=require('../branching/predictor/native.cjs');
    const file=path.join(directory,'scopes.cy.js');fs.writeFileSync(file,'// registered native suite');
    const tests=[['skip','group','skipped'],['first','group','passed'],['last','group','passed'],['other','other','passed'],['skip-last','other','skipped']]
        .map(([id,scope,expectedStatus])=>({id,titlePath:[scope,id],expectedStatus,timingSource:'() => cy.wait(1)'}));
    const hooks=['before','beforeEach','afterEach','after'].map(kind=>({kind,scope:['group'],source:'() => cy.wait(2)'}));
    native.collector({featureSchema:p.REACHABLE_SCHEMA_V5,sourceFamily:'fixture',baselineMs:100,sourceStore:path.join(directory,'sources'),
        environment:{browser:'pinned'}},directory,directory)({file,tests,hooks});
    const rows=JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    const roles=row=>row.snapshot.sourceArchive.filter(source=>source.name.startsWith('hook-')).map(source=>source.role);
    assert.deepEqual(rows.map(row=>row.id),['first','last','other']);
    assert.deepEqual(rows.map(row=>row.snapshot.extraFeatures),[
        {'execution.first':1,'execution.last':0},
        {'execution.first':0,'execution.last':0},
        {'execution.first':0,'execution.last':1}
    ]);
    assert.deepEqual(roles(rows[0]),['work','work','work','context']);
    assert.deepEqual(roles(rows[1]),['context','work','work','work']);
    assert.deepEqual(roles(rows[2]),[]);
});

test('Playwright callback features use reported source locations without executing helpers', t => {
    const {directory}=model(t), native=require('../branching/predictor/native.cjs');
    const file=path.join(directory,'journey.spec.ts');
    fs.writeFileSync(file,'import {test} from "@playwright/test";\ntest("journey", async ({page}) => { await page.goto("/"); });\n');
    assert.equal(native.sourceAt(file,2,1),'const work = async ({page}) => { await page.goto("/"); };');
    assert.throws(()=>native.sourceAt(file,1,1),error=>error.statusCode===500 && /No test callback/.test(error.issues[0].message));
    const helper=path.join(directory,'helper.ts');fs.writeFileSync(helper,'export const count = 3;');
    native.collector({runner:'playwright',files:[helper],sourceFamily:'fixture',baselineMs:100,environment:{browser:'pinned'}},directory,directory)(
        {file,hooks:[],tests:[{id:'test',titlePath:[],timingSource:native.sourceAt(file,2,1),expectedStatus:'passed'}]});
    const report={results:[{id:'test',durationMs:100,status:'passed',attempts:1,errors:[]}]};
    native.finish(directory,report);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'prediction-samples.json')))[0].eligible,true);
    fs.appendFileSync(helper,'\nexport const changed = true;');native.finish(directory,report);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'prediction-samples.json')))[0].eligible,false);
});

test('ordinary Cypress profiling matches duplicate titles to frozen per-test forecasts', t => {
    const {directory,file}=model(t), cwd=process.cwd();
    t.after(()=>process.chdir(cwd));process.chdir(directory);
    fs.writeFileSync('dependencies.yaml','pinned runtime');
    fs.mkdirSync('.runtime/predictor',{recursive:true});
    const data=JSON.parse(fs.readFileSync(file));data.domains[0].runner='cypress';data.domains[0].unit='test';data.domains[0].timingBoundary='cypress-test-duration-minus-preparation/v2';
    fs.writeFileSync(file,JSON.stringify(data));
    fs.writeFileSync('.runtime/predictor/profile.json',JSON.stringify({model:file,baselineMs:100,sourceFamily:'fixture'}));
    const spec=path.join(directory,'test.cy.js');fs.writeFileSync(spec,'it("same",()=>{}); it("same",()=>{});');
    const session=require('../branching/predictor/session.cjs').start([spec],'cypress');
    const profile=JSON.parse(process.env.MAGELENS_NATIVE_PROFILE), tasks={};
    const config={projectRoot:directory,supportFile:false};
    require('../branching/predictor/browser.cjs').installCypress((name,value)=>Object.assign(tasks,value),config);
    const identity=require('../branching/runners/cypress/native-support.cjs').identity;
    tasks['magelens:timing:prepare']({file:spec,hooks:[],tests:[0,1].map(i=>({id:identity(spec,['same'],i),titlePath:['same'],timingSource:'() => {}'}))});
    const frozen=fs.readFileSync(path.join(profile.directory,'predictions.json'),'utf8');
    const report=session.finish({passed:true,results:{runs:[{spec:{absolute:spec},tests:[120,180].map(duration=>({title:['same'],state:'passed',duration,attempts:[{}]}))}]}});
    assert.deepEqual(report.samples.map(s=>s.timing.nativeMs),[120,180]);
    assert.equal(report.samples[0].actualMs,120-JSON.parse(frozen)[0].preparationMs);
    assert.equal(report.samples[1].actualMs,180);
    assert.ok(report.samples.every(s=>s.unit==='test'&&s.eligible));assert.equal(report.quality.status,'scored');
    assert.equal(fs.readFileSync(path.join(profile.directory,'predictions.json'),'utf8'),frozen);
    assert.equal(process.env.MAGELENS_NATIVE_PROFILE,undefined);
    const failed=require('../branching/predictor/session.cjs').start([spec],'cypress');
    assert.equal(failed.finish({passed:false,results:{runs:[]}}).quality.status,'incomplete');
});

test('ordinary Playwright reporter evaluates test durations through the training collector', t => {
    t.mock.method(require('../branching/predictor/playwright.cjs'),'describe',()=>({timingSource:'const work = async()=>{};',timingSources:[],files:[]}));
    const {directory,file}=model(t), cwd=process.cwd();
    t.after(()=>process.chdir(cwd));process.chdir(directory);
    fs.writeFileSync('dependencies.yaml','pinned runtime');
    fs.mkdirSync('.runtime/predictor',{recursive:true});
    const data=JSON.parse(fs.readFileSync(file));data.domains[0].unit='test';data.domains[0].timingBoundary='playwright-test-result-duration/v1';fs.writeFileSync(file,JSON.stringify(data));
    fs.writeFileSync('.runtime/predictor/profile.json',JSON.stringify({model:file,baselineMs:100,sourceFamily:'fixture'}));
    const spec=path.join(directory,'test.spec.js');fs.writeFileSync(spec,'test("works",async()=>{});');
    const session=require('../branching/predictor/session.cjs').start([spec],'playwright');
    fs.writeFileSync('coverage/run.json',JSON.stringify({id:'run'}));
    const Reporter=require('../playwright/reporter.cjs'), reporter=new Reporter();
    const result={status:'passed',duration:150,errors:[]};
    const entry={id:'one',title:'works',titlePath:()=>['','browser','test.spec.js','works'],
        location:{file:spec,line:1,column:1},parent:{project:()=>({name:'browser'})},
        expectedStatus:'passed',annotations:[],results:[result]};
    reporter.onBegin({rootDir:directory,projects:[{name:'browser',dependencies:[]}]},{allTests:()=>[entry]});
    const profile=JSON.parse(process.env.MAGELENS_NATIVE_PROFILE);
    const frozen=fs.readFileSync(path.join(profile.directory,'predictions.json'),'utf8');
    reporter.onTestEnd(entry,result);reporter.onEnd({status:'passed',duration:999});
    const report=session.finish({passed:true});
    assert.equal(report.samples[0].timingBoundary,'playwright-test-result-duration/v1');
    assert.equal(report.samples[0].actualMs,150);assert.equal(report.samples[0].unit,'test');
    assert.equal(report.quality.status,'scored');assert.equal(report.quality.samples,1);
    assert.equal(fs.readFileSync(path.join(profile.directory,'predictions.json'),'utf8'),frozen);
    assert.equal(process.env.MAGELENS_NATIVE_PROFILE,undefined);
});

test('loaded Playwright metadata includes fixture dependencies, overrides and scoped hooks without executing them', () => {
    const {describe}=require('../branching/predictor/playwright.cjs');
    const make=(name,scope='test',deps=[],options={})=>({name,scope,deps,fn:()=>{throw Error('Must not execute');},location:{file:'/project/fixtures.js'},...options});
    const original=make('cart'), replacement=make('cart','test',['cart']), worker=make('worker','worker'), timed=make('timed','test',['cart'],{timeout:100}), auto=make('auto');
    const builtin=make('baseURL','test',[],{location:{file:'/runner/index.js'}});
    const inherited=make('baseURL','test',[],{fn:builtin.fn,optionOverride:true,super:builtin,location:{file:'project#browser'}});
    const registrations=new Map([replacement,worker,timed,auto,inherited].map(r=>[r.name,r]));
    const pool={resolve:(name,from)=>name===from?.name?original:registrations.get(name),autoFixtures:()=>[auto]};
    const api={root:'/runner',fixtures:{fixtureParameterNames:fn=>fn.deps??[]},poolBuilder:{PoolBuilder:{createForWorker:()=>({_buildPoolForTest:()=>pool})}}};
    const fn=()=>{};fn.deps=['worker','timed','baseURL'];
    const hooks=['beforeAll','beforeEach','afterEach','afterAll'].map(type=>({type,fn:()=>{},location:{file:'/project/spec.js'}}));
    const result=describe({_testType:{},fn,location:{file:'/project/spec.js'},parent:{_hooks:hooks}},api);
    assert.deepEqual(result.files.sort(),['/project/fixtures.js','/project/spec.js']);
    assert.deepEqual(result.timingSources.slice(0,4).map(s=>s.role),['context','work','work','context']);
    const fixtures=result.timingSources.slice(4);
    assert.equal(fixtures.length,5);assert.equal(fixtures.filter(s=>s.role==='work').length,3);
    assert.throws(()=>describe({parent:{}},api),error=>error.statusCode===500);
});
test('loaded Playwright callbacks support generated declarations and method syntax', () => {
    const {functionSource}=require('../branching/predictor/playwright.cjs');
    for(const fn of [async()=>{},function work(){},{async work(){}}.work]) {
        assert.doesNotThrow(()=>p.features({...request(),sources:[{name:'loaded.js',source:functionSource(fn)}]}));
    }
    assert.throws(()=>functionSource(Math.max),error=>error.statusCode===500);
});

test('compressed CI transport preserves the pinned model and rejects conflicting or corrupted inputs before installation', t => {
    const {spawnSync}=require('node:child_process'),{pack,unpack}=require('../branching/predictor/transport.cjs');
    const {directory,file}=model(t),data=JSON.parse(fs.readFileSync(file));
    data.training={note:'training evidence '.repeat(10000)};
    const bytes=Buffer.from(JSON.stringify(data));fs.writeFileSync(file,bytes);
    const encoded=pack(bytes);assert.ok(encoded.length<48*1024);assert.deepEqual(unpack(encoded+'\n'),bytes);
    const script=path.join(__dirname,'ci/predictor-model.cjs');
    const invoke=(name,overrides={})=>{
        const cwd=path.join(directory,name);fs.mkdirSync(cwd);
        const result=spawnSync(process.execPath,[script],{cwd,encoding:'utf8',env:{...process.env,GITHUB_ENV:path.join(cwd,'environment'),
            MAGELENS_PREDICTOR_MODEL_JSON:'',MAGELENS_PREDICTOR_MODEL_GZIP_BASE64:encoded,MAGELENS_PREDICTOR_MODEL_SHA256:p.sha256(bytes),...overrides}});
        return {cwd,result,installed:path.join(cwd,'.runtime/predictor/model.json')};
    };
    const valid=invoke('valid');assert.equal(valid.result.status,0,valid.result.stderr);assert.deepEqual(fs.readFileSync(valid.installed),bytes);
    for(const [name,overrides] of [['digest',{MAGELENS_PREDICTOR_MODEL_SHA256:'0'.repeat(64)}],['conflict',{MAGELENS_PREDICTOR_MODEL_JSON:bytes.toString()}],['encoding',{MAGELENS_PREDICTOR_MODEL_GZIP_BASE64:'not base64!'}]]) {
        const failed=invoke(name,overrides);assert.notEqual(failed.result.status,0);assert.equal(fs.existsSync(failed.installed),false);
    }
    assert.throws(()=>unpack(require('node:zlib').gzipSync(Buffer.alloc(4*1024*1024+1)).toString('base64')));
    assert.throws(()=>pack(Buffer.alloc(4*1024*1024+1)));
});


test('Cypress preparation time is charged once per spec and kept separate from test work', t => {
    const {directory}=model(t), native=require('../branching/predictor/native.cjs');
    let clock=100;
    t.mock.method(performance,'now',()=>{clock+=50;return clock;});
    const file=path.join(directory,'timing.cy.js');fs.writeFileSync(file,'it("works",()=>{});');
    const tests=['skip','first','last'].map(id=>({id,titlePath:[id],timingSource:'()=>{}',expectedStatus:id==='skip'?'skipped':'passed'}));
    native.collector({baselineMs:100,sourceFamily:'fixture'},directory,directory)({file,tests,hooks:[]});
    const frozen=JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    assert.equal(frozen[0].preparationMs,50);assert.equal(frozen[1].preparationMs,undefined);
    assert.equal(frozen[0].snapshot.environmentDigest,p.sha256(JSON.stringify([['boundary','cypress-test-duration-minus-preparation/v2'],['hookAttribution','scoped-once/v1']])));
    const report={results:['first','last'].map(id=>({id,durationMs:200,status:'passed',attempts:1,errors:[]}))};
    native.finish(directory,report);
    const samples=JSON.parse(fs.readFileSync(path.join(directory,'prediction-samples.json')));
    assert.deepEqual(samples.map(s=>s.actualMs),[150,200]);
    assert.deepEqual(samples.map(s=>s.timing),[{nativeMs:200,preparationMs:50},{nativeMs:200,preparationMs:0}]);
    report.results[0].durationMs=40;
    assert.throws(()=>native.finish(directory,report),error=>error.code==='ESTIMATION_FAILED'&&error.statusCode===500&&error.issues[0].message==='Invalid measured preparation overhead');
});


test('timing boundary revisions retain forecasts and mark domain transfer', t => {
    const {loaded}=model(t), input=request();
    const snapshot=p.prepare({...input,timingBoundary:'native-work/v2'},loaded);
    assert.ok(snapshot.prediction.ms>0);assert.equal(snapshot.prediction.domainMatched,false);assert.equal(snapshot.prediction.executionEligible,false);assert.equal(snapshot.predictionError,null);
    assert.throws(()=>p.predict(snapshot,loaded,{shadow:true}),e=>e.statusCode===500&&e.issues[0].message.includes('timing boundary'));
    loaded.model.domains[0].timingBoundary='native-work/v2';
    assert.ok(p.prepare({...input,timingBoundary:'native-work/v2'},loaded).prediction);
    assert.equal(p.prepare(input,loaded).prediction.domainMatched,false);
    assert.throws(()=>p.prepare({...input,timingBoundary:{}},loaded),e=>e.statusCode===500);
});

test('environment transfer remains diagnostic until the matching domain is qualified', t => {
    const {loaded}=model(t);
    loaded.model.qualified=true;
    const snapshot=p.prepare(request(),loaded);
    assert.equal(snapshot.prediction.domainMatched,true);
    assert.equal(snapshot.prediction.outOfRange,false);
    assert.equal(snapshot.prediction.environmentKnown,false);
    assert.equal(snapshot.prediction.executionEligible,false);
    assert.throws(()=>p.predict(snapshot,loaded),e=>/Environment/.test(e.issues[0].message));
    loaded.model.domains[0].environmentDigest=snapshot.environmentDigest;
    assert.equal(p.predict(snapshot,loaded,{transfer:true}).executionEligible,true);
    assert.equal(p.prepare({...request(),environment:{browser:'different',workers:1}},loaded).prediction.executionEligible,false);
});

test('v5 bounds require a complete matching domain instead of mixing feature ranges', () => {
    const width=p.REACHABLE_WIDTH;
    const vector=Array(width).fill(0);
    const domain={runner:'cypress',unit:'test',ranges:Array.from({length:width},()=>[0,1])};
    const first=structuredClone(domain), second=structuredClone(domain);
    first.ranges[0]=[1,2];
    second.ranges[1]=[1,2];
    const loaded={id:'fixture',model:{featureSchema:p.REACHABLE_SCHEMA_V5,qualified:true,referenceBaselineMs:1,errorLogP90:0,
        domains:[first,second],estimator:{intercept:1,mean:vector,scale:Array(width).fill(1),coefficients:vector}}};
    const snapshot={featureSchema:p.REACHABLE_SCHEMA_V5,runner:'cypress',unit:'test',vector,baselineMs:1,manualMultiplier:1};
    const forecast=p.predict(snapshot,loaded,{shadow:true,transfer:true});
    assert.equal(forecast.domainMatched,true);
    assert.equal(forecast.outOfRange,true);
    assert.equal(forecast.executionEligible,false);
});


test('reachable helper schema extracts 1024-wide vectors and isolates called helpers from unused context', () => {
    const input = {
        ...request(),
        featureSchema: p.REACHABLE_SCHEMA,
        sources: [
            {name: 'test.ts', source: "import {helperCalled} from './helpers.ts'; function run() { helperCalled(); }", role: 'work'},
            {name: 'helpers.ts', source: 'export function helperCalled() { return 1; }\nfunction helperUnused() { return 2; }', role: 'context'}
        ]
    };
    const features = p.features(input);
    assert.equal(features.featureSchema, p.REACHABLE_SCHEMA);
    assert.equal(features.vector.length, p.REACHABLE_WIDTH);
    assert.equal(p.REACHABLE_WIDTH, 1024);
    assert.ok(features.vector.every(Number.isFinite));
    // Verify work and context parts are populated
    assert.ok(features.vector.slice(0, 512).some(x => x > 0));
    assert.ok(features.vector.slice(512).some(x => x > 0));
    // Changing unused helper in context does not change reachable context vector
    const changed = {
        ...input,
        sources: [
            input.sources[0],
            {name: 'helpers.ts', source: 'export function helperCalled() { return 1; }\nfunction helperUnused() { return "heavily modified content with lots of extra statements and syntax nodes"; }', role: 'context'}
        ]
    };
    const changedFeatures = p.features(changed);
    assert.deepEqual(features.vector, changedFeatures.vector);
});

test('chunked CI model transport preserves large snapshots and rejects gaps, conflicts and corruption', t => {
    const {spawnSync}=require('node:child_process'),{randomBytes}=require('node:crypto');
    const {pack,packChunks,unpackChunks}=require('../branching/predictor/transport.cjs');
    const {directory,file}=model(t),data=JSON.parse(fs.readFileSync(file));
    data.training={note:randomBytes(60000).toString('hex')};
    const bytes=Buffer.from(JSON.stringify(data)),chunks=packChunks(bytes);
    assert.throws(()=>pack(bytes),/variable size limit/);
    assert.ok(chunks.length>1);assert.ok(chunks.every(chunk=>chunk.length<=48*1024));
    assert.deepEqual(unpackChunks(chunks),bytes);
    assert.throws(()=>unpackChunks([chunks[0],'',chunks[1]]));
    assert.throws(()=>unpackChunks(Array(5).fill('AAAA')));
    assert.throws(()=>unpackChunks(['A'.repeat(48*1024+1)]));
    const env={...process.env,MAGELENS_PREDICTOR_MODEL_JSON:'',MAGELENS_PREDICTOR_MODEL_GZIP_BASE64:'',MAGELENS_PREDICTOR_MODEL_SHA256:p.sha256(bytes)};
    for(let i=0;i<4;i++)env[`MAGELENS_PREDICTOR_MODEL_GZIP_BASE64_${i+1}`]=chunks[i]??'';
    const invoke=(name,overrides)=>{
        const cwd=path.join(directory,name);fs.mkdirSync(cwd);
        const result=spawnSync(process.execPath,[path.join(__dirname,'ci/predictor-model.cjs')],{cwd,encoding:'utf8',env:{...env,GITHUB_ENV:path.join(cwd,'environment'),...overrides}});
        return {result,file:path.join(cwd,'.runtime/predictor/model.json')};
    };
    const valid=invoke('valid');assert.equal(valid.result.status,0,valid.result.stderr);assert.deepEqual(fs.readFileSync(valid.file),bytes);
    for(const [name,overrides] of [
        ['gap',{MAGELENS_PREDICTOR_MODEL_GZIP_BASE64_1:''}],
        ['conflict',{MAGELENS_PREDICTOR_MODEL_JSON:'{}'}],
        ['corrupt',{MAGELENS_PREDICTOR_MODEL_GZIP_BASE64_2:'AAAA'}],
        ['digest',{MAGELENS_PREDICTOR_MODEL_SHA256:'0'.repeat(64)}]
    ]) {const failed=invoke(name,overrides);assert.notEqual(failed.result.status,0);assert.equal(fs.existsSync(failed.file),false);}
});

test('native observations exclude declared lifecycle projects without relying on project names', t => {
    const {directory}=model(t),native=require('../branching/predictor/native.cjs');
    const file=path.join(directory,'journey.spec.js');fs.writeFileSync(file,'const work = async () => {};');
    const tests=['prepare-account','storefront','clean-account','setup'].map(id=>({id,project:id,titlePath:[id],timingSource:'async () => {}',expectedStatus:'passed'}));
    native.collector({runner:'playwright',sourceFamily:'fixture',baselineMs:100},directory,directory)({file,tests,hooks:[]});
    const report={config:{projects:[{name:'storefront',dependencies:['prepare-account']},{name:'prepare-account',teardown:'clean-account'},{name:'setup'}]},tests,
        results:tests.map(({id})=>({id,status:'passed',attempts:1,durationMs:100,errors:[]}))};
    native.finish(directory,report);
    const rows=JSON.parse(fs.readFileSync(path.join(directory,'prediction-samples.json')));
    assert.deepEqual(rows.map(row=>row.eligible),[false,true,false,true]);
    assert.equal(rows[0].exclusion,'Project lifecycle dependency');
    assert.equal(rows[2].actualMs,100);
    assert.equal(rows[2].lifecycleDependency,true);
    assert.deepEqual(rows[2].timing,{nativeMs:100,preparationMs:0});
    fs.appendFileSync(file, '\n// changed after prediction');
    native.finish(directory,report);
    const changed=JSON.parse(fs.readFileSync(path.join(directory,'prediction-samples.json')));
    assert.equal(changed[0].eligible,false);
    assert.equal(changed[0].lifecycleDependency,true);
    assert.equal(changed[0].exclusion,'Failed, retried, incomplete or changed-source run');
});

test('auditAndReextractDataset re-extracts complete source archives under v5 and quarantines incomplete rows without zero-filling', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-audit-test-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));

    const sourceStore = path.join(root, 'sources');
    fs.mkdirSync(sourceStore);

    const source1 = "cy.visit('/cart');";
    const hash1 = p.sha256(source1);
    fs.writeFileSync(path.join(sourceStore, hash1), source1);

    const source2 = "export function helper() { return 42; }";
    const hash2 = p.sha256(source2);
    fs.writeFileSync(path.join(sourceStore, hash2), source2);

    const missingHash = 'deadbeef'.repeat(8);
    const sourceDigest = p.features({runner:'cypress',unit:'test',featureSchema:p.REACHABLE_SCHEMA_V4,
        sources:[{name:'callback.js',source:source1,role:'work'},{name:'helper.js',source:source2,role:'context'}]}).sourceDigest;

    const dataset = [
        {
            observationId: 'obs-complete',
            featureSchema: p.REACHABLE_SCHEMA_V4,
            sourceDigest,
            prediction: {ms:1000},
            runner: 'cypress',
            unit: 'test',
            timingBoundary: p.TEST_TIMING_BOUNDARY,
            group: 'spec.cy.js',
            sourceFamily: 'branching',
            eligible: true,
            baselineMs: 1000,
            actualMs: 1050,
            sourceArchive: [
                {name: 'callback.js', sha256: hash1, role: 'work'},
                {name: 'helper.js', sha256: hash2, role: 'context'}
            ]
        },
        {
            observationId: 'obs-incomplete',
            featureSchema: p.REACHABLE_SCHEMA_V4,
            runner: 'cypress',
            unit: 'test',
            group: 'spec2.cy.js',
            sourceFamily: 'branching',
            eligible: true,
            baselineMs: 1000,
            actualMs: 1200,
            sourceArchive: [
                {name: 'callback.js', sha256: hash1, role: 'work'},
                {name: 'missing.js', sha256: missingHash, role: 'context'}
            ]
        }
    ];
    dataset.push({...dataset[0],observationId:'obs-substituted',sourceDigest:'different'});
    dataset.push({...dataset[0],observationId:'obs-failed',eligible:false});
    dataset.push({...dataset[0],observationId:'obs-unversioned',timingBoundary:undefined});
    dataset.push({...dataset[0],observationId:'obs-fragment',measurementKind:'source-fragment-diagnostic'});

    const datasetFile = path.join(root, 'dataset.json');
    fs.writeFileSync(datasetFile, JSON.stringify(dataset));

    const result = p.auditAndReextractDataset(datasetFile, sourceStore, {
        targetSchema: p.REACHABLE_SCHEMA_V5
    });

    assert.equal(result.provenance.totalAudited, 6);
    assert.equal(result.provenance.retainedCount, 1);
    assert.equal(result.provenance.quarantinedCount, 5);
    assert.match(result.provenance.quarantinedDetails.find(row => row.observationId === 'obs-fragment').reason,
        /lacks a complete execution audit/);
    assert.equal(result.provenance.missingSourceHashCount, 1);
    assert.deepEqual(result.provenance.missingSourceHashes, [missingHash]);

    // Retained row must be updated to v5 schema with 1024-wide vector
    const retained = result.rows[0];
    assert.equal(retained.observationId, 'obs-complete');
    assert.equal(retained.featureSchema, p.REACHABLE_SCHEMA_V5);
    assert.equal(retained.vector.length, p.REACHABLE_WIDTH);
    assert.ok(retained.reextractedAt);
    assert.equal(retained.prediction,undefined);
    assert.deepEqual(retained.originalForecast.prediction,{ms:1000});

    // Quarantined row is not in rows
    assert.equal(result.rows.length, 1);
    assert.equal(result.provenance.quarantinedDetails[0].observationId, 'obs-incomplete');
    assert.match(result.provenance.quarantinedDetails[0].reason, /Incomplete source archive/);
    assert.match(result.provenance.quarantinedDetails[1].reason, /recorded source digest/);
    assert.match(result.provenance.quarantinedDetails[2].reason, /Ineligible timing observation/);
    assert.match(result.provenance.quarantinedDetails[3].reason, /missing timing boundary provenance/);
});

test('executed segments require a matching forecast and an independent successful audit', () => {
    const {observeExecutedSegment,SEGMENT_TIMING_BOUNDARY} = require('../branching/predictor/prefix-measurement.cjs');
    const {digest} = require('../branching/identity.cjs');
    const snapshot = {unit:'prefix',timingBoundary:SEGMENT_TIMING_BOUNDARY,sourceDigest:'original',
        prediction:{ms:11},segment:{fromDepth:1,toDepth:2}};
    const segment = {id:'segment',status:'passed',wallMs:15,prefixTiming:{
        timingBoundary:SEGMENT_TIMING_BOUNDARY,forecast:{digest:digest(snapshot)},kind:'steps',
        fromDepth:1,toDepth:2,workMs:12,workCompleted:true
    }};
    const audit = {passed:true,attempts:1,sourceDigest:'original'};
    assert.equal(observeExecutedSegment(snapshot,segment,audit).eligible,true);
    assert.equal(observeExecutedSegment(snapshot,segment).eligible,false);
    assert.equal(observeExecutedSegment(snapshot,{...segment,status:'failed'},audit).eligible,false);
    assert.equal(observeExecutedSegment(snapshot,segment,{...audit,sourceDigest:'changed'}).eligible,false);
    assert.throws(()=>observeExecutedSegment({...snapshot,prediction:{ms:99}},segment,audit),/matching frozen/);
});

test('prefix measurement protocol enforces checkpoint-prefix/v1 boundary, separate overhead, and incremental segments', () => {
    const {validatePrefixMeasurement, recordPrefixObservation, PREFIX_TIMING_BOUNDARY} = p;

    // Snapshot skeleton
    const snapshot = {
        schemaVersion: 1,
        observationId: 'obs-prefix-1',
        featureSchema: p.REACHABLE_SCHEMA_V5,
        vector: Array(p.REACHABLE_WIDTH).fill(0),
        sourceDigest: 'digest-1',
        runner: 'cypress',
        unit: 'prefix',
        timingBoundary: PREFIX_TIMING_BOUNDARY,
        group: 'hash-group',
        sourceFamily: 'hash-family',
        environmentDigest: 'env-1',
        baselineMs: 1000,
        manualMultiplier: 1,
        prediction: { ms: 500 }
    };

    // Valid observation with separate overhead
    const valid = recordPrefixObservation(snapshot, {
        prefixWorkMs: 480,
        preparationMs: 15,
        checkpointCaptureMs: 120,
        checkpointRestoreMs: 45,
        resetMs: 30,
        wallTimeMs: 690
    }, { fromDepth: 0, toDepth: 2, passed: true, attempts: 1 });

    assert.equal(valid.eligible, true);
    assert.equal(valid.exclusion, null);
    assert.equal(valid.actualMs, 480);
    assert.equal(valid.timings.checkpointOverheadMs, 195);
    assert.equal(valid.segment.isIncremental, false);
    assert.equal(valid.segment.hasFixtureSetup, true);

    // Incremental segment between checkpoints (fromDepth > 0)
    const incremental = recordPrefixObservation(snapshot, {
        prefixWorkMs: 250,
        checkpointCaptureMs: 110
    }, { fromDepth: 2, toDepth: 3 });

    assert.equal(incremental.eligible, true);
    assert.equal(incremental.segment.isIncremental, true);
    assert.equal(incremental.segment.hasFixtureSetup, false);

    // Validation catches invalid depth order
    const mismatched = recordPrefixObservation(snapshot,{
        prefixWorkMs:100,timingBoundary:'checkpoint-segment-run-duration/v1'
    });
    assert.equal(mismatched.eligible,false);
    assert.equal(mismatched.errorMs,null);
    const segment = recordPrefixObservation({...snapshot,timingBoundary:'checkpoint-segment-run-duration/v1'},
        {prefixWorkMs:100,timingBoundary:'checkpoint-segment-run-duration/v1'},{kind:'fixture',fromDepth:0,toDepth:0});
    assert.equal(segment.eligible,true);
    assert.equal(segment.segment.hasFixtureSetup,true);
    assert.equal(mismatched.timingBoundary,'checkpoint-segment-run-duration/v1');
    assert.match(mismatched.exclusion,/same supported prefix timing boundary/);
    assert.equal(recordPrefixObservation({...snapshot,unit:'test'},{prefixWorkMs:100}).eligible,false);

    const invalidDepth = recordPrefixObservation(snapshot, { prefixWorkMs: 100 }, { fromDepth: 3, toDepth: 2 });
    assert.equal(invalidDepth.eligible, false);
    assert.match(invalidDepth.exclusion, /fromDepth .* must be strictly less than toDepth/);

    // Validation catches failed attempts
    const failed = recordPrefixObservation(snapshot, { prefixWorkMs: 100 }, { passed: false });
    assert.equal(failed.eligible, false);
    assert.match(failed.exclusion, /failed/i);

    // Validation catches retries
    const retried = recordPrefixObservation(snapshot, { prefixWorkMs: 100 }, { attempts: 2 });
    assert.equal(retried.eligible, false);
    assert.match(retried.exclusion, /retried/i);

    // Validation catches negative overhead or zero duration
    const badTiming = validatePrefixMeasurement({
        unit: 'prefix',
        timingBoundary: PREFIX_TIMING_BOUNDARY,
        actualMs: 0,
        timings: { checkpointRestoreMs: -5 }
    });
    assert.equal(badTiming.valid, false);
    assert.ok(badTiming.issues.some(i => i.includes('actualMs')));
    assert.ok(badTiming.issues.some(i => i.includes('checkpointRestoreMs must be finite and nonnegative')));
});

test('checkpoint decision quality evaluates break-even, false positives, missed savings, uncertainty, and restoration eligibility', () => {
    const {evaluateCheckpointDecisions} = p;
    // Default overhead: capture = 5000ms, restore = 1500ms
    // For 3 consumers: (capture + 2 * restore) / 2 = (5000 + 3000) / 2 = 4000ms break-even threshold
    const rows = [
        // 1. True positive: predicted 8000ms, actual 7000ms (> 4000ms break-even). Savings = 2 * 7000 - 8000 = 6000ms.
        {
            id: 'tp-1',
            unit: 'prefix',
            eligible: true,
            consumers: 3,
            actualMs: 7000,
            prediction: { ms: 8000, lowerMs: 7500, upperMs: 8500 }
        },
        // 2. True negative: predicted 2000ms, actual 1500ms (< 4000ms break-even).
        {
            id: 'tn-1',
            unit: 'prefix',
            eligible: true,
            consumers: 3,
            actualMs: 1500,
            prediction: { ms: 2000, lowerMs: 1800, upperMs: 2200 }
        },
        // 3. False positive: predicted 6000ms, but actual was only 2000ms (< 4000ms break-even).
        // Penalty = 8000 (overhead) - 2 * 2000 = 4000ms slowdown.
        {
            id: 'fp-1',
            unit: 'prefix',
            eligible: true,
            consumers: 3,
            actualMs: 2000,
            prediction: { ms: 6000, lowerMs: 5000, upperMs: 7000 }
        },
        // 4. False negative (missed savings): predicted 2500ms, but actual was 6000ms (> 4000ms break-even).
        // Missed savings = 2 * 6000 - 8000 = 4000ms.
        {
            id: 'fn-1',
            unit: 'prefix',
            eligible: true,
            consumers: 3,
            actualMs: 6000,
            prediction: { ms: 2500, lowerMs: 2000, upperMs: 3000 }
        },
        // 5. Uncertain near break-even: confidence interval [3500, 4500] spans 4000ms threshold
        {
            id: 'unc-1',
            unit: 'prefix',
            eligible: true,
            consumers: 3,
            actualMs: 4200,
            prediction: { ms: 4100, lowerMs: 3500, upperMs: 4500 }
        },
        // 6. Restoration ineligible: state is not deterministically restorable
        {
            id: 'inelig-1',
            unit: 'prefix',
            eligible: true,
            consumers: 3,
            actualMs: 10000,
            restorationEligible: false,
            prediction: { ms: 12000, lowerMs: 11000, upperMs: 13000 }
        }
    ];

    const report = evaluateCheckpointDecisions(rows);
    assert.equal(report.status, 'measured');
    assert.equal(report.total, 6);
    assert.equal(report.truePositives, 2); // tp-1 and unc-1 (both predicted > 4000 and actual > 4000)
    assert.equal(report.trueNegatives, 1); // tn-1
    assert.equal(report.falsePositives, 1); // fp-1
    assert.equal(report.falseNegatives, 1); // fn-1
    assert.equal(report.uncertainCount, 1); // unc-1
    assert.equal(report.ineligibleCount, 1); // inelig-1
    assert.ok(report.totalRealizedSavingsMs > 0);
    assert.ok(report.totalSlowdownMs > 0);
    assert.ok(report.totalMissedSavingsMs > 0);

    // Verify p.evaluate integrates checkpointDecisions for prefix rows
    const evalResult = p.evaluate(rows);
    assert.equal(evalResult.checkpointDecisions.status, 'measured');
    assert.equal(evalResult.checkpointDecisions.total, 6);
    assert.equal(evalResult.checkpointDecisions.falsePositives, 1);
});

test('dataset audit quarantines changed bytes, unsafe hashes, symlinks and duplicate names', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-source-integrity-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const bytes = 'cy.visit("/");', hash = p.sha256(bytes);
    const file = path.join(root, hash), dataset = path.join(root, 'dataset.json');
    const entry = {name: 'callback.js', sha256: hash};
    let calls = 0;
    const audit = archive => {
        fs.writeFileSync(dataset, JSON.stringify([{sourceArchive: archive}]));
        return p.auditAndReextractDataset(dataset, root, {features: () => { calls++; }});
    };
    fs.writeFileSync(file, bytes + '// changed');
    assert.match(audit([entry]).provenance.quarantinedDetails[0].reason, /hash mismatch/);
    assert.equal(audit([{...entry, sha256: '../outside'}]).rows.length, 0);
    fs.writeFileSync(file, bytes);
    assert.equal(audit([entry, entry]).rows.length, 0);
    fs.renameSync(file, file + '-target');
    fs.symlinkSync(file + '-target', file);
    assert.match(audit([entry]).provenance.quarantinedDetails[0].reason, /regular file/);
    assert.equal(calls, 0);
});

test('checkpoint policy changes do not rescale default model forecasts', t => {
    const {loaded}=model(t), input=request();
    delete input.baselineMs;
    const config=require('../branching-baseline.json'), previous=config.checkpointDecisionBaselineMs;
    t.after(()=>{config.checkpointDecisionBaselineMs=previous;});
    config.checkpointDecisionBaselineMs=106638.8;
    const before=p.prepare(input,loaded);
    config.checkpointDecisionBaselineMs=44906.12;
    const after=p.prepare(input,loaded);
    assert.equal(after.prediction.factor,1);
    assert.equal(after.baselineMs,loaded.model.referenceBaselineMs);
    assert.deepEqual(after.prediction,before.prediction);
    assert.equal(p.prepare({...input,baselineMs:200},loaded).prediction.factor,2);
});


test('native profiling excludes only explicitly identified diagnostic hooks', t => {
    const {directory}=model(t), native=require('../branching/predictor/native.cjs');
    const file=path.join(directory,'application-hooks.cy.js');fs.writeFileSync(file,'// application hooks');
    const inputs=[];
    t.mock.method(p,'prepare',input=>{inputs.push(input);return {sources:input.sources};});
    const applicationHooks=[
        "() => cy.task('measurement:reindex')",
        "() => cy.task('magelens:seed')",
        "() => cy.task('diagnostic:prepare-application')",
        "() => Cypress.on('command:start', event => recordApplicationEvent(event))",
        '() => {const start=performance.now(); events.push(start);}'
    ];
    const diagnostic='() => recordInstrumentation()';
    native.collector({baselineMs:100},directory,directory)({file,
        tests:[{id:'one',titlePath:['flow'],timingSource:'() => {}'}],
        hooks:[...applicationHooks.map(source=>({scope:[],kind:'beforeEach',source})),
            {scope:[],kind:'beforeEach',source:diagnostic,diagnostic:true}]});
    assert.deepEqual(inputs[0].sources.filter(source=>source.name.startsWith('hook-')).map(source=>source.source),applicationHooks);
    assert.deepEqual(inputs[0].environment.diagnosticHooks,[diagnostic]);
    assert.equal(inputs[0].sources.find(source=>source.source===diagnostic).role,'context');
});

test('native Playwright profiling recovers an inline TypeScript callback from its registration location', t => {
    const {directory} = model(t);
    const native = require('../branching/predictor/native.cjs');
    const file = path.join(directory,'flow.spec.ts');
    const helper = path.join(directory,'helper.ts');
    fs.writeFileSync(file, 'import {load} from "./helper";\ntest("flow", async () => { const limit: number = 2; await load(limit); });');
    fs.writeFileSync(helper, 'export async function load(limit: number) { return limit; }');
    const fixture = path.join(directory,'fixture.ts');
    fs.writeFileSync(fixture,'import {seed} from "./seed";\nexport const configured = test.extend({ other: async () => unused(), fixture: [async () => { const count: number = 1; return seed(count); }, {auto:true}] });');
    const seed = path.join(directory,'seed.ts');
    fs.writeFileSync(seed,'export function seed() { return 1; }');
    const sourceStore = path.join(directory,'sources');
    native.collector({runner:'playwright',featureSchema:p.REACHABLE_SCHEMA_V5,files:[helper,fixture,seed],sourceStore,
        sourceFamily:'fixture',environment:{browser:'pinned'}},directory,directory)({
        file,hooks:[],tests:[{id:'flow',titlePath:[],line:2,column:1,timingSource:'const work = async () => { const limit = 2; await load(limit); };',
            timingSources:[{name:'fixture.js',source:'const work = async () => { const count = 1; return seed(count); };',role:'work',kind:'fixture',fixtureName:'fixture',location:{file:fixture,line:2,column:32}}]}]
    });
    const [{snapshot}] = JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    assert.equal(snapshot.selectedImplementations.length,2);
    const callback = snapshot.sourceArchive.find(source => source.name === 'callback.js');
    assert.equal(snapshot.sourceArchive.find(source => source.name === 'fixture.js').origin.file,'context/fixture.ts');
    assert.equal(callback.origin.file,'spec/flow.spec.ts');
    assert.match(fs.readFileSync(path.join(sourceStore,callback.sha256),'utf8'),/limit: number/);
});

test('Cypress native hook provenance includes the configured support module', t => {
    const {directory} = model(t);
    const file = path.join(directory,'flow.cy.js');
    const supportFile = path.join(directory,'support.ts');
    const helper = path.join(directory,'seed.js');
    fs.writeFileSync(file, 'it("flow", () => cy.visit("/"));');
    const support = 'import {seed} from "./seed"; import config from "./site-config.json";\nbeforeEach(() => { const limit: number = 1; return seed(limit, config.value); });';
    fs.writeFileSync(supportFile, support);
    fs.writeFileSync(helper, 'export function seed() { return 1; }');
    const collect = require('../branching/predictor/native.cjs').collector({
        runner:'cypress',featureSchema:p.REACHABLE_SCHEMA_V5,supportFile,
        sourceStore:path.join(directory,'sources'),sourceFamily:'fixture',environment:{browser:'pinned'}
    },directory,directory);
    const batch = {file,tests:[{id:'flow',titlePath:['flow'],timingSource:'const work = () => cy.visit("/");'}],
        hooks:[{scope:[],kind:'beforeEach',source:'const hook = () => {const limit = 1; return seed(limit, config.value);};'}]};
    collect(batch);
    const [{snapshot}] = JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    assert.equal(snapshot.sourceArchive.find(source=>source.name==='hook-0.js').origin.file,'context/support.ts');
    assert.equal(snapshot.selectedImplementations.length,1);
    const generatedLocation = {url:'http://runner.invalid/__cypress/tests?p=support.ts',line:1,column:1};
    const transformed = {...batch.hooks[0],generatedLocation,
        source:'const hook = () => {const limit = 1; return (0, _seed.seed)(limit, _siteConfig.default.value);};'};
    const map = {version:3,sources:['support.ts'],sourcesContent:[support],names:[],mappings:'AACA'};
    const mappedBatch = content => ({...batch,hooks:[transformed],sourceMaps:{
        [generatedLocation.url]:Buffer.from(JSON.stringify({...map,sourcesContent:[content]})).toString('base64')
    }});
    collect(mappedBatch(support + '\n'));
    const [,babel] = JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    assert.equal(babel.snapshot.sourceArchive.find(source=>source.name==='hook-0.js').origin,undefined);
    collect(mappedBatch(support));
    const [,,mapped] = JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    assert.equal(mapped.snapshot.sourceArchive.find(source=>source.name==='hook-0.js').origin.file,'context/support.ts');
    assert.equal(mapped.snapshot.selectedImplementations.length,1);
    fs.appendFileSync(supportFile,'\nafterEach(() => { const limit: string = 1; return seed(limit, config.value); });');
    collect(batch);
    const [,,,ambiguous] = JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    assert.equal(ambiguous.snapshot.sourceArchive.find(source=>source.name==='hook-0.js').origin,undefined);
});

test('Cypress native profiling archives the original config and identifies runner and browser calls', t => {
    const {directory} = model(t);
    const file = path.join(directory,'flow.cy.js');
    const configFile = path.join(directory,'cypress.config.cjs');
    const supportFile = path.join(directory,'support.js');
    const body = "() => { cy.loadCart(); cy.task('fixture:seed'); }";
    fs.writeFileSync(file,'it("flow", '+body+');');
    fs.writeFileSync(configFile,"module.exports={e2e:{setupNodeEvents(on){on('task', {'fixture:seed'(){ return 1; }});}}};");
    fs.writeFileSync(supportFile,"Cypress.Commands.add('loadCart', () => cy.visit('/cart'));");
    require('../branching/predictor/native.cjs').collector({
        runner:'cypress',featureSchema:p.REACHABLE_SCHEMA_V5,configFile,supportFile,
        sourceStore:path.join(directory,'sources'),sourceFamily:'fixture',environment:{browser:'pinned'}
    },directory,directory)({file,hooks:[],tests:[{id:'flow',titlePath:['flow'],timingSource:'const work = '+body+';'}]});
    const [{snapshot}] = JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    assert.deepEqual(snapshot.registeredCalls.map(edge=>[edge.process,edge.to]).sort(),
        [['browser','context/support.js'],['runner','context/cypress.config.cjs']]);
    assert.equal(snapshot.selectedImplementations.length,2);
});

test('discovery snapshots cannot be finalized as timing observations', t => {
    const {directory} = model(t);
    const file = path.join(directory,'flow.cy.js');
    fs.writeFileSync(file,'it("flow", () => {});');
    const native = require('../branching/predictor/native.cjs');
    native.collector({runner:'cypress',discoveryOnly:true,sourceFamily:'fixture',environment:{browser:'pinned'}},
        directory,directory)({file,hooks:[],tests:[{id:'flow',titlePath:['flow'],timingSource:'const work = () => {};'}]});
    const [row] = JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    assert.equal(row.discoveryOnly,true);
    assert.equal(row.preparationMs,undefined);
    assert.throws(()=>native.finish(directory,{results:[{id:'flow',durationMs:50,status:'passed',attempts:1,errors:[]}]}),
        /Discovery snapshots cannot produce timing observations/);
    assert.equal(fs.existsSync(path.join(directory,'prediction-samples.json')),false);
});

test('mapped Cypress location does not substitute an unrelated call containing an inline callback', t => {
    const {directory} = model(t);
    const file = path.join(directory,'flow.cy.ts');
    fs.writeFileSync(file,'configure(() => wrongHelper());\nit("flow", () => realHelper());');
    require('../branching/predictor/native.cjs').collector({
        runner:'cypress',featureSchema:p.REACHABLE_SCHEMA_V5,sourceStore:path.join(directory,'sources'),
        sourceFamily:'fixture',environment:{browser:'pinned'}
    },directory,directory)({file,hooks:[],tests:[{
        id:'flow',titlePath:['flow'],timingLocation:{line:1,column:1},
        timingSource:'const work = () => emitted.realHelper();'
    }]});
    const [{snapshot}] = JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    assert.equal(snapshot.sourceArchive[0].origin,undefined);
    assert.ok(!snapshot.unresolvedEdges.some(edge=>edge.callee==='wrongHelper'));
});

test('v5 pre-run backend facts distinguish known zero from unavailable measurements', () => {
    const input = {...request(),featureSchema:p.REACHABLE_SCHEMA_V5};
    const backendState = {version:1,indexBacklog:0,workers:2,cacheState:'cold'};
    const snapshot = p.prepare({...input,backendState});
    assert.deepEqual(snapshot.backendState,backendState);
    assert.notDeepEqual(snapshot.vector,p.features(input).vector);
    assert.deepEqual(snapshot.vector,p.features({...input,backendState:snapshot.backendState}).vector);
    assert.throws(()=>p.features({...input,backendState:{version:1,indexBacklog:-1}}),
        error=>/Invalid pre-run backend field/.test(error.issues[0].message));
    const v4 = {...input,featureSchema:p.REACHABLE_SCHEMA_V4};
    assert.deepEqual(p.features({...v4,backendState}),p.features(v4));
});

test('scoped catalog evaluation requires every frozen repetition to meet the existing accuracy target', () => {
    const {digest} = require('../branching/identity.cjs');
    const {evaluateCatalogQualification} = require('../branching/predictor/catalog-qualification.cjs');
    const model = require('./fixtures/branching/predictor.cjs').model(100);
    model.qualified = false;
    model.training = {folds: {developmentA: 0, developmentB: 1}};
    const domain = model.domains.find(d => d.runner === 'playwright' && d.unit === 'test');
    const loaded = {model, id: 'model'};
    const protocol = {modelId: loaded.id, runner: 'playwright', unit: 'test', timingBoundary: domain.timingBoundary,
        trainingGroups: Object.keys(model.training.folds), fixtureDigests: ['120-products', '240-products'], cases: []};
    for (const split of ['validation', 'audit']) {
        for (const fixtureDigest of protocol.fixtureDigests) {
            for (let repeat = 0; repeat < 2; repeat++) {
                const id = [split, fixtureDigest, repeat].join('-');
                const snapshot = {modelId: loaded.id, runner: protocol.runner, unit: protocol.unit,
                    timingBoundary: protocol.timingBoundary, group: split, featureSchema: model.featureSchema,
                    vector: model.estimator.mean.map(() => 0), sourceDigest: id,
                    environmentDigest: domain.environmentDigest, baselineMs: model.referenceBaselineMs, manualMultiplier: 1};
                protocol.cases.push({id, split, group: split, fixtureDigest, snapshot});
            }
        }
    }
    const observations = protocol.cases.map(({id, fixtureDigest, snapshot}) => ({
        caseId: id, fixtureDigest, forecastDigest: digest(snapshot), sourceDigest: snapshot.sourceDigest,
        environmentDigest: snapshot.environmentDigest, eligible: true, attempts: 1,
        sourceVerified: true, suitePassed: true, coverageVerified: true, actualMs: 100
    }));
    const run = () => evaluateCatalogQualification({protocol, protocolDigest: digest(protocol), loaded, observations});
    assert.equal(run().passed, true);
    observations[0].actualMs = 120;
    assert.equal(run().passed, false);
    observations[0].forecastDigest = 'changed';
    assert.throws(run, /frozen inputs/);
});
