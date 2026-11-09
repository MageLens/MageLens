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
test('matrix captures predictions once before execution and detects source changes', t => {
    const {file,directory}=model(t),matrix=require('./performance/branching/predictor.cjs');
    fs.mkdirSync(path.join(directory,'suite'));
    for(const name of ['journeys.spec.js','bootstrap.setup.js']) fs.writeFileSync(path.join(directory,'suite',name),'const items = [1,2];');
    matrix.capture(directory,request(),file);
    assert.throws(()=>matrix.capture(directory,request(),file),/EEXIST/);
    const timing={testsMs:200,status:'passed',passed:1,tests:['a'],fallbacks:0,cleanup:true};
    assert.equal(matrix.complete(directory,timing).eligible,true);
    fs.appendFileSync(path.join(directory,'suite/journeys.spec.js'),'\nconst changed = true;');
    assert.equal(matrix.complete(directory,timing).eligible,false);
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
    const tests=[['skip','group','skipped'],['first','group','passed'],['last','group','passed'],['other','other','passed']]
        .map(([id,scope,expectedStatus])=>({id,titlePath:[scope,id],expectedStatus,timingSource:'() => cy.wait(1)'}));
    const hooks=['before','beforeEach','afterEach','after'].map(kind=>({kind,scope:['group'],source:'() => cy.wait(2)'}));
    native.collector({sourceFamily:'fixture',baselineMs:100,sourceStore:path.join(directory,'sources'),
        environment:{browser:'pinned'}},directory,directory)({file,tests,hooks});
    const rows=JSON.parse(fs.readFileSync(path.join(directory,'predictions.json')));
    const roles=row=>row.snapshot.sourceArchive.filter(source=>source.name.startsWith('hook-')).map(source=>source.role);
    assert.deepEqual(rows.map(row=>row.id),['first','last','other']);
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
    const data=JSON.parse(fs.readFileSync(file));data.domains[0].unit='test';fs.writeFileSync(file,JSON.stringify(data));
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


test('timing boundary revisions reject old models even for shadow forecasts', t => {
    const {loaded}=model(t), input=request();
    const snapshot=p.prepare({...input,timingBoundary:'native-work/v2'},loaded);
    assert.equal(snapshot.prediction,null);assert.equal(snapshot.predictionError.code,'ESTIMATION_FAILED');
    assert.throws(()=>p.predict(snapshot,loaded,{shadow:true}),e=>e.statusCode===500&&e.issues[0].message.includes('timing boundary'));
    loaded.model.domains[0].timingBoundary='native-work/v2';
    assert.ok(p.prepare({...input,timingBoundary:'native-work/v2'},loaded).prediction);
    assert.equal(p.prepare(input,loaded).prediction,null);
    assert.throws(()=>p.prepare({...input,timingBoundary:{}},loaded),e=>e.statusCode===500);
});
