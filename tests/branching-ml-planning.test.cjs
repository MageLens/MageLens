// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const p=require('../branching/predictor/index.cjs');
const {assess,boundary}=require('../branching/predictor/planning.cjs');
const {assertAssessed,assertExecutable}=require('../branching/estimation.cjs');
function fixture(t, firstStep = "cy.visit('/cart');") {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-ml-plan-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const callback=`()=>{${firstStep}cy.get('button').click();}`;
    const source=`// 🛒\nimport {helper} from './helper.js';\ndescribe('cart',()=>{before(()=>helper());it('first',${callback});it('second',${callback});});`;
    const helper="throw new Error('Project source must never execute'); export function helper(){return cy.request('/seed');}";
    fs.writeFileSync(path.join(root,'flow.cy.js'),source);fs.writeFileSync(path.join(root,'helper.js'),helper);
    const tests=[];let offset=0;
    for(const id of ['first','second']) {
        const at=source.indexOf(callback,offset);offset=at+callback.length;
        const bodyStart=source.indexOf(firstStep,at);
        const start=Buffer.byteLength(source.slice(0,bodyStart)),end=start+Buffer.byteLength(firstStep);
        tests.push({id,title:id,file:'flow.cy.js',fixture:'cypress:it',scope:'scope',line:2,callbackStart:Buffer.byteLength(source.slice(0,at)),callbackEnd:Buffer.byteLength(source.slice(0,offset)),steps:[{start,end,kind:'statement'}]});
    }
    const manifest={schemaVersion:1,implementation:'rust-prefix-v3',root,sources:[['flow.cy.js',source],['helper.js',helper]].map(([path,bytes])=>({path,sha256:p.sha256(bytes)})),tests,
        checkpoints:[{id:'cp-cart',depth:1,representative:'first',consumers:['first','second'],automatic:true}],diagnostics:[],assessment:{analysis:{collectionComplete:true}}};
    const width=p.REACHABLE_WIDTH;
    const model={schemaVersion:1,featureSchema:p.REACHABLE_SCHEMA,qualified:true,referenceBaselineMs:106638.8,errorLogP90:0.2,
        estimator:{intercept:Math.log1p(1234),inputTransform:'log1p',mean:Array(width).fill(0),scale:Array(width).fill(1),coefficients:Array(width).fill(0)},
        domains:[{runner:'cypress',unit:'test',timingBoundary:'cypress-test-duration-minus-preparation/v2'}, {runner:'cypress',unit:'prefix',timingBoundary:boundary}].map(d=>({...d,
            environmentDigest:p.sha256(JSON.stringify(Object.entries({boundary:d.timingBoundary,collection:'source',platform:process.platform}).sort())),
            ranges:Array(width).fill([0,1e9])}))};
    const file=path.join(root,'model.json');fs.writeFileSync(file,JSON.stringify(model));
    return {manifest,model,load(){fs.writeFileSync(file,JSON.stringify(model));return p.loadModel(file);}};
}
test('ML planning uses source fingerprints and predictions without executing project code',t=>{
    const f=fixture(t),loaded=f.load();const result=assess(f.manifest,{loaded});
    assert.equal(result.assessment.status,'complete');assertAssessed(result);
    assert.ok(Math.abs(result.assessment.tests.first.prediction.ms-1234)<1e-6);
    assert.ok(Math.abs(result.assessment.stages['cp-cart'].prediction.ms-1234)<1e-6);
    assert.equal(result.assessment.stages['cp-cart'].timingBoundary,boundary);
    assert.notEqual(result.assessment.tests.first.sourceDigest,result.assessment.tests.second.sourceDigest,'suite hooks are work only for first/last scoped test');
    assert.deepEqual(assess(f.manifest,{loaded}),result,'no random metadata enters saved plans');
    fs.appendFileSync(path.join(f.manifest.root,'helper.js'),'// changed');
    assert.throws(()=>assess(f.manifest,{loaded}),/Source changed/);
});
test('checkpoint segment preserves imported helper bindings and byte ranges', t => {
    const f = fixture(t, 'helper();');
    const unused = 'export function helper(){ return cy.request("/unrelated"); }';
    fs.writeFileSync(path.join(f.manifest.root,'unused.js'),unused);
    f.manifest.sources.push({path:'unused.js',sha256:p.sha256(unused)});
    const result = assess(f.manifest,{loaded:f.load()});
    const segment = result.assessment.stages['cp-cart'];
    assert.equal(segment.input.selectedImplementations.length,1);
    assert.equal(segment.input.sources.find(source=>source.name==='prefix.js').origin.ranges.length,1);
    assert.ok(!segment.input.unresolvedEdges.some(edge=>edge.callee==='helper'));
});
test('whole-test models forecast prefixes with explicit transfer warnings and no heuristic fallback',t=>{
    const f=fixture(t);f.model.domains=f.model.domains.filter(d=>d.unit==='test');
    const result=assess(f.manifest,{loaded:f.load()});
    assert.ok(result.assessment.tests.first.prediction);
    assert.ok(result.assessment.stages['cp-cart'].prediction.ms>0);
    assert.equal(result.assessment.stages['cp-cart'].prediction.domainMatched,false);
    assert.match(JSON.stringify(result.assessment.stages['cp-cart'].warnings),/unvalidated timing boundary/);
    assert.ok(result.assessment.candidates[0].estimatedSegmentMs>0);
    assertAssessed(result);
    assert.throws(()=>assertExecutable(result),error=>{
        assert.equal(error.code,'ESTIMATION_FAILED');
        const issue=error.issues.find(issue=>issue.id==='cp-cart');
        assert.equal(issue?.unit,'prefix');
        assert.equal(issue?.timingBoundary,boundary);
        assert.match(issue.message,/no matching validated model domain/);
        return true;
    });
});
test('unqualified models remain visible for evaluation but cannot authorize execution',t=>{
    const f=fixture(t);f.model.qualified=false;
    const result=assess(f.manifest,{loaded:f.load()});
    assert.ok(result.assessment.tests.first.prediction);
    assert.match(JSON.stringify(result.assessment.tests.first.warnings),/qualification/);
    assertAssessed(result);
    assert.throws(()=>assertExecutable(result),error=>error.statusCode===500);
});
test('invalid or missing model stops ML planning',t=>{
    const f=fixture(t);
    assert.throws(()=>assess(f.manifest,{model:path.join(f.manifest.root,'absent.json')}),/Cost assessment failed/);
    const result=assess(f.manifest,{loaded:f.load()});result.assessment.stages['cp-cart'].prediction.ms=NaN;
    assert.throws(()=>assertExecutable(result),error=>error.statusCode===500);
});
test('separately trained timing units retain their model identities and qualifications', t => {
    const f = fixture(t);
    const domains = f.model.domains;
    f.model.domains = domains.filter(domain => domain.unit === 'test');
    const loaded = f.load();
    f.model.domains = domains.filter(domain => domain.unit === 'prefix');
    const prefixLoaded = f.load();
    const result = assess(f.manifest, {loaded, prefixLoaded});
    assert.equal(result.assessment.tests.first.prediction.modelId, loaded.id);
    assert.equal(result.assessment.stages['cp-cart'].prediction.modelId, prefixLoaded.id);
    assertExecutable(result);
    assert.throws(() => assertExecutable(assess(f.manifest, {loaded, prefixLoaded: {
        ...prefixLoaded, model: {...prefixLoaded.model, qualified: false}
    }})), /Cost assessment failed/);
    result.assessment.prefixModelId = loaded.id;
    assert.throws(() => assertAssessed(result), /Cost assessment failed/);
});
test('reachable inherited constructors remain parseable without changing ordinary method features',()=>{
    const {reachableContext}=require('../branching/predictor/reachable.cjs');
    const sources=[{name:'work.js',role:'work',source:"import {Adapter} from './helper.js'; const x = new Adapter(); x.constructor();"},
        {name:'helper.js',role:'context',source:'export class Adapter extends Base {constructor(){super();} ordinary(){return 1;}}'}];
    const reachable=reachableContext(sources);assert.ok(reachable.some(s=>s.source.includes('super()')));
    assert.doesNotThrow(()=>p.features({runner:'cypress',unit:'test',sources,featureSchema:p.REACHABLE_SCHEMA}));
});

test('packaged ML planner preserves failures until successful replanning',t=>{
    const {planner}=require('../branching/planner-client.cjs');
    const root=require('./fixtures/branching/planner.cjs').plannerFixture(t,'magelens-ml-cli-',{model:require('./fixtures/branching/predictor.cjs').model(100)});
    const source=path.join(root,'source');fs.mkdirSync(source);
    const file=path.join(source,'flow.cy.js'),output=path.join(root,'plan.json');
    const original="it('one',()=>{cy.visit('/cart');cy.get('#one').click();});it('two',()=>{cy.visit('/cart');cy.get('#two').click();});";
    fs.writeFileSync(file,original);
    const run=(...args)=>planner(args,{stdio:'pipe'});
    run('plan',source,output);run('verify',output);
    const saved=fs.readFileSync(output,'utf8');
    fs.writeFileSync(file,'it(');
    assert.throws(()=>run('plan',source,output));
    assert.equal(fs.readFileSync(output,'utf8'),saved);
    assert.equal(JSON.parse(fs.readFileSync(output+'.error.json')).code,'ESTIMATION_FAILED');
    fs.writeFileSync(file,original);
    run('evaluate',source,output);
    assert.ok(fs.existsSync(output+'.error.json'));
    assert.throws(()=>run('verify',output));
    run('plan',source,output);run('verify',output);
    assert.equal(fs.existsSync(output+'.error.json'),false);
    const segmentBoundary = 'checkpoint-segment-run-duration/v1';
    const sourceStore = path.join(root,'segment-sources');
    const prefixPath = path.join(root, 'prefix-model.json');
    const prefix = require('./fixtures/branching/predictor.cjs').model(250);
    prefix.featureSchema = p.REACHABLE_SCHEMA_V5;
    fs.writeFileSync(prefixPath, JSON.stringify(prefix));
    const backendState = {version:1, dataRows:120, workers:1, cacheState:'warm'};
    const env = {...process.env,MAGELENS_PREFIX_TIMING_BOUNDARY:segmentBoundary,MAGELENS_PREFIX_SOURCE_STORE:sourceStore,
        MAGELENS_PREDICTOR_BACKEND_STATE:JSON.stringify(backendState),
        MAGELENS_PREFIX_MODEL:prefixPath,MAGELENS_PREFIX_MODEL_SHA256:p.sha256(fs.readFileSync(prefixPath))};
    const segmentOutput = path.join(root,'segment-plan.json');
    planner(['plan',source,segmentOutput],{stdio:'pipe'},env);
    const segmentPlan = JSON.parse(fs.readFileSync(segmentOutput));
    assert.equal(segmentPlan.assessment.prefixTimingBoundary,segmentBoundary);
    assert.equal(segmentPlan.assessment.prefixModelId,env.MAGELENS_PREFIX_MODEL_SHA256);
    assert.notEqual(segmentPlan.assessment.modelId,segmentPlan.assessment.prefixModelId);
    const snapshot = Object.values(segmentPlan.assessment.stages).find(stage=>stage.trainingSnapshot)?.trainingSnapshot;
    assert.ok(snapshot,'The shared checkpoint must have a frozen training snapshot');
    assert.deepEqual(snapshot.backendState,backendState);
    assert.ok(snapshot.sourceArchive.length > 0);
    for (const source of snapshot.sourceArchive)
        assert.equal(p.sha256(fs.readFileSync(path.join(sourceStore,source.sha256))),source.sha256);
    planner(['verify',segmentOutput],{stdio:'pipe'},env);
    assert.throws(()=>planner(['verify',segmentOutput],{stdio:'pipe'}, {...env,
        MAGELENS_PREDICTOR_BACKEND_STATE:JSON.stringify({...backendState, dataRows:240})}), /changed/);
    const prefixBytes = fs.readFileSync(prefixPath);
    fs.appendFileSync(prefixPath,' ');
    assert.throws(()=>planner(['verify',segmentOutput],{stdio:'pipe'},env), /digest|SHA-256|checksum/i);
    fs.writeFileSync(prefixPath,prefixBytes);
    snapshot.vector[0] += 1;
    fs.writeFileSync(segmentOutput,JSON.stringify(segmentPlan));
    assert.throws(()=>planner(['verify',segmentOutput],{stdio:'pipe'},env));
    assert.throws(()=>run('verify',segmentOutput));
    fs.appendFileSync(path.join(root,'model.json'),' ');
    assert.throws(()=>run('plan',source,output));
    assert.equal(fs.readFileSync(output,'utf8'),saved);
});

test('offline forecasts include configured support hooks, their dependencies and native execution flags',t=>{
    const f=fixture(t);
    function add(file,source){const target=path.join(f.manifest.root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source);f.manifest.sources.push({path:file,sha256:p.sha256(source)});}
    add('cypress.config.cjs',"module.exports={e2e:{supportFile:'support/setup.js'}};");
    add('support/setup.js',"import {reset} from './commands.js';if (Cypress.expose('option')) require('./commands.js');beforeEach(()=>reset());afterEach(()=>reset());before(()=>reset());");
    add('support/commands.js',"export function reset(){cy.request('/reset');}");
    f.manifest.sourceDependencies={'support/setup.js':['support/commands.js']};
    for(const test of f.manifest.tests)test.contextFiles=['flow.cy.js','helper.js'];
    const result=assess(f.manifest,{loaded:f.load()});
    for(const row of Object.values(result.assessment.tests)) {
        assert.ok(row.warnings.some(warning=>warning.includes('Conditional Cypress support imports')));
        assert.ok(row.input.sources.some(s=>s.name==='context/support/commands.js'));
        assert.ok(row.input.sources.some(s=>s.role==='work' && s.sha256===p.sha256('const hook = ()=>reset();')));
    }
    assert.deepEqual(result.assessment.tests.first.input.extraFeatures,{'execution.first':1,'execution.last':0});
    assert.deepEqual(result.assessment.tests.second.input.extraFeatures,{'execution.first':0,'execution.last':1});
    assert.ok(result.assessment.stages['cp-cart'].input.sources.some(s=>s.name==='global-beforeEach-0.js' && s.role==='work'));
    const segmentBoundary = 'checkpoint-segment-run-duration/v1';
    const measured = assess(f.manifest,{loaded:f.load(),prefixTimingBoundary:segmentBoundary}).assessment.stages['cp-cart'];
    assert.equal(measured.timingBoundary,segmentBoundary);
    assert.deepEqual(measured.trainingSnapshot.segment,measured.segment);
    assert.equal(measured.trainingSnapshot.sourceDigest,measured.sourceDigest);
    assert.equal(measured.trainingSnapshot.vector.length,p.REACHABLE_WIDTH);
    assert.ok(!measured.input.sources.some(source=>source.name.startsWith('global-beforeEach-')));
    assert.equal(measured.prediction.domainMatched,false);
    const config=f.manifest.sources.find(s=>s.path==='cypress.config.cjs');
    const disabled='module.exports={e2e:{supportFile:false}};';fs.writeFileSync(path.join(f.manifest.root,config.path),disabled);config.sha256=p.sha256(disabled);
    const without=assess(f.manifest,{loaded:f.load()});
    assert.ok(!without.assessment.tests.first.input.sources.some(s=>s.name==='context/support/commands.js'));
});

test('reachable nested callbacks preserve their lexical super binding',()=>{
    const sources=[{name:'work.js',source:'adapter.run();',role:'work'},
        {name:'helper.js',source:'export class Adapter extends Base {run(){const invoke=()=>super.run();return invoke();}}',role:'context'}];
    assert.doesNotThrow(()=>p.features({runner:'cypress',unit:'test',sources,featureSchema:p.REACHABLE_SCHEMA}));
});

test('v5 planner assigns once-only work to the first runnable test',t=>{
    const f=fixture(t);
    f.manifest.tests[0].staticallySkipped=true;
    const result=assess(f.manifest,{loaded:f.load()});
    const {first,second}=result.assessment.tests;
    assert.deepEqual(second.input.extraFeatures,{'execution.first':1,'execution.last':1});
    assert.equal(first.input.sources.find(source=>source.name==='hook-0.js').role,'context');
    assert.equal(second.input.sources.find(source=>source.name==='hook-0.js').role,'work');
});

test('reconciliation matches original ranges and retains repeated hook work',()=>{
    const origin={file:'source.js',start:2,end:9};
    const context={name:'source.js',role:'context',sha256:'original'};
    const callback={name:'callback.js',sha256:'callback',origin};
    const hook={name:'hook-1.js',sha256:'hook',origin};
    const native={sources:[context,{...callback,sha256:'rewrapped'},hook,{...hook,name:'hook-2.js'}]};
    const result=p.reconcileWorkloadInputs({sources:[context,callback,hook]},native);
    assert.equal(result.callbackMatch,true);
    assert.deepEqual(result.missingSupportHooks,['hook-2.js']);
    assert.equal(result.matched,false);
});

test('matching callbacks cannot establish parity after extraction failure or across schemas',()=>{
    const sources=[{name:'callback.js',sha256:'callback'}];
    const native={sources,featureSchema:p.REACHABLE_SCHEMA_V5};
    for (const input of [
        {sources,extracted:false},
        {sources,extracted:true,featureSchema:p.REACHABLE_SCHEMA_V4}
    ]) {
        const result=p.reconcileWorkloadInputs(input,native);
        assert.equal(result.callbackMatch,true);
        assert.equal(result.extractionMatch,false);
        assert.equal(result.matched,false);
    }
});

test('reconciliation reports native Playwright hook and fixture work',()=>{
    const sources=[{name:'callback.js',sha256:'callback'}];
    const result=p.reconcileWorkloadInputs({sources},{sources:[
        ...sources,
        {name:'lifecycle-0-beforeEach.js',sha256:'before'},
        {name:'lifecycle-1-fixture.js',sha256:'fixture'},
        {name:'lifecycle-2-fixture.js',sha256:'worker',role:'context'}
    ]});
    assert.deepEqual(result.missingSupportHooks,['lifecycle-0-beforeEach.js']);
    assert.deepEqual(result.missingFixtures,['lifecycle-1-fixture.js']);
    assert.equal(result.matched,false);
});

test('an opaque fixture provider remains visible even when no native fixture is listed',t=>{
    const f=fixture(t);
    f.manifest.tests[0].opaqueFixtureProvider=true;
    const row=assess(f.manifest,{loaded:f.load()}).assessment.tests.first;
    assert.ok(row.warnings.includes('Playwright fixture provider requires native lifecycle inputs'));
    const compare=p.reconcileWorkloadInputs(row.input,{...row.input,opaqueFixtureProvider:false});
    assert.equal(compare.matched,false);
    assert.ok(compare.discrepancies.includes('Static Playwright fixture provider requires native lifecycle inputs'));
});

test('planner replays hash-verified fixture discovery and rejects stale configuration',t=>{
    const f=fixture(t);
    const testCase=f.manifest.tests[0];
    testCase.fixture='local:extended';
    testCase.opaqueFixtureProvider=true;
    const config='playwright.config.cjs';
    const configSource='module.exports = {};';
    fs.writeFileSync(path.join(f.manifest.root,config),configSource);
    const configDigest=p.sha256(configSource);
    f.manifest.sources.push({path:config,sha256:configDigest});
    const spec=fs.readFileSync(path.join(f.manifest.root,testCase.file));
    const helper="const fixture = async ({page}, use) => { await use(page); };";
    fs.writeFileSync(path.join(f.manifest.root,'fixture.js'),helper);
    f.manifest.sources.push({path:'fixture.js',sha256:p.sha256(helper)});
    const row={discoveryOnly:true,configDigest,fileHash:p.sha256(spec),snapshot:{
        runner:'playwright',unit:'test',timingBoundary:'playwright-test-result-duration/v1',
        sourceArchive:[
            {name:'spec.js',sha256:p.sha256(spec)},
            {name:'callback.js',origin:{file:'spec.js',
                start:spec.subarray(0,testCase.callbackStart).toString().length,
                end:spec.subarray(0,testCase.callbackEnd).toString().length}},
            {name:'fixture.js',sha256:p.sha256(helper)},
            {name:'lifecycle-0-fixture.js',role:'work',sha256:p.sha256(helper.replace('const fixture','const work')),
                origin:{file:'fixture.js',start:helper.indexOf('async'),end:helper.length-1}}
        ]
    }};
    const options={loaded:f.load(),discoveryConfig:config,discoveryByTest:new Map([[testCase.id,row]])};
    const result=assess(f.manifest,options).assessment.tests.first;
    assert.ok(result.input.sources.some(source=>source.name==='lifecycle-0-fixture.js'&&source.origin.file==='context/fixture.js'));
    assert.equal(result.input.opaqueFixtureProvider,undefined);
    const dependencyRoot=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-discovery-dependency-'));
    t.after(()=>fs.rmSync(dependencyRoot,{recursive:true,force:true}));
    const dependencyFile=path.join(dependencyRoot,'fixture.js');
    fs.writeFileSync(dependencyFile,helper);
    f.manifest.sources=f.manifest.sources.filter(entry=>entry.path!=='fixture.js');
    row.files=[{file:path.join(f.manifest.root,testCase.file),hash:p.sha256(spec)},
        {file:dependencyFile,hash:p.sha256(helper)}];
    row.snapshot.sourceArchive[2]={name:'context/node_modules/fixture.js',role:'context',sha256:p.sha256(helper)};
    row.snapshot.sourceArchive[3].origin.file='context/node_modules/fixture.js';
    assert.throws(()=>assess(f.manifest,options),/escapes selected source roots/);
    options.discoveryDependencyRoots=[dependencyRoot];
    const external=assess(f.manifest,options).assessment.tests.first;
    assert.ok(external.input.sources.some(source=>source.name==='lifecycle-0-fixture.js'&&
        source.origin.file==='context/node_modules/fixture.js'));
    fs.appendFileSync(dependencyFile,' ');
    assert.throws(()=>assess(f.manifest,options),/Discovery source changed/);
    fs.writeFileSync(dependencyFile,helper);
    options.environment={platform:'catalog-fixture'};
    const prefixEnvironmentBefore=assess(f.manifest,{...options,environment:undefined}).assessment.stages['cp-cart'].environmentDigest;
    row.snapshot.environmentDigest=p.sha256(JSON.stringify(Object.entries({
        ...options.environment,hookAttribution:'scoped-once/v1',lifecycle:'playwright-loaded-fixtures/v1',
        boundary:'playwright-test-result-duration/v1'
    }).sort()));
    assert.equal(assess(f.manifest,options).assessment.tests.first.environmentDigest,row.snapshot.environmentDigest);
    assert.equal(assess(f.manifest,options).assessment.stages['cp-cart'].environmentDigest,prefixEnvironmentBefore);
    options.prefixEnvironment = {executionRuntimeDigest:'bounded-prefix-runtime'};
    const separated = assess(f.manifest,options).assessment;
    assert.notEqual(separated.stages['cp-cart'].environmentDigest,prefixEnvironmentBefore);
    assert.equal(separated.stages['cp-cart'].environmentDigest,p.sha256(JSON.stringify(Object.entries({
        ...options.prefixEnvironment,boundary,collection:'source',platform:process.platform
    }).sort())));
    assert.equal(separated.tests.first.environmentDigest,row.snapshot.environmentDigest);
    assert.throws(()=>assess(f.manifest,{...options,prefixEnvironment:[]}),/Invalid prefix environment/);
    options.environment.platform='changed';
    assert.throws(()=>assess(f.manifest,options),/Discovery environment does not match/);
    options.environment.platform='catalog-fixture';
    const fixtureEntry=row.snapshot.sourceArchive.at(-1);
    fixtureEntry.sha256='changed';
    assert.throws(()=>assess(f.manifest,options),/Discovery fixture hash does not match/);
    row.configDigest='stale';
    assert.throws(()=>assess(f.manifest,options),/Discovery configuration does not match/);
});

test('reconciliation reports different runnable test ordering even with identical source',()=>{
    const sources=[{name:'callback.js',sha256:'callback'}];
    const result=p.reconcileWorkloadInputs(
        {sources,extraFeatures:{'execution.first':0,'execution.last':1}},
        {sources,extraFeatures:{'execution.first':1,'execution.last':1}});
    assert.equal(result.callbackMatch,true);
    assert.deepEqual(result.executionOrderDifferences,['execution.first']);
    assert.equal(result.matched,false);
});

test('reconcileWorkloadInputs detects discrepancies and isolates diagnostic hooks without inspecting duration',()=>{
    const callbackSource = "cy.visit('/cart');";
    const hookSource = "cy.request('/seed');";
    const helperDigest = 'a1b2c3d4e5f6';

    const staticInput = {
        sources: [
            {name: 'callback.js', role: 'work', sha256: p.sha256(callbackSource)},
            {name: 'hook-0.js', role: 'work', sha256: p.sha256(hookSource)},
            {name: 'context/helper.js', role: 'context', sha256: 'somehash'}
        ],
        selectedImplementations: [`reachable-${helperDigest}.js`]
    };

    const nativeSnapshot = {
        sources: [
            {name: 'callback.js', role: 'work', sha256: p.sha256(callbackSource), source: callbackSource},
            {name: 'hook-0.js', role: 'work', sha256: p.sha256(hookSource), source: hookSource},
            {name: 'diagnostic-hook-0.js', role: 'context', diagnostic: true, source: "cy.task('measurement:start');"},
            {name: 'context/helper.js', role: 'context', sha256: 'somehash'}
        ],
        selectedImplementations: [`reachable-${helperDigest}.js`],
        environment: {
            diagnosticHooks: ["cy.task('measurement:start');"]
        }
    };

    const clean = p.reconcileWorkloadInputs(staticInput, nativeSnapshot);
    assert.equal(clean.matched, true);
    assert.equal(clean.callbackMatch, true);
    assert.equal(clean.missingSupportHooks.length, 0);
    assert.equal(clean.unexpectedHooks.length, 0);
    assert.equal(clean.missingHelpers.length, 0);
    assert.ok(clean.diagnosticHooks.length > 0);
    assert.equal(clean.discrepancies.length, 0);

    // Mismatched support hook
    const missingHookNative = {
        ...nativeSnapshot,
        sources: [
            ...nativeSnapshot.sources,
            {name: 'hook-1.js', role: 'work', sha256: p.sha256("cy.request('/extra-hook');")}
        ]
    };
    const hookMismatch = p.reconcileWorkloadInputs(staticInput, missingHookNative);
    assert.equal(hookMismatch.matched, false);
    assert.ok(hookMismatch.missingSupportHooks.includes('hook-1.js'));
    assert.ok(hookMismatch.discrepancies.some(d => d.includes('support hook(s) observed natively are missing')));

    // Helper mismatch
    const helperMismatchStatic = {
        ...staticInput,
        selectedImplementations: []
    };
    const helperMismatch = p.reconcileWorkloadInputs(helperMismatchStatic, nativeSnapshot);
    assert.equal(helperMismatch.matched, false);
    assert.deepEqual(helperMismatch.missingHelpers, [`reachable-${helperDigest}.js`]);

    // Callback mismatch
    const callbackMismatchStatic = {
        ...staticInput,
        sources: [
            {name: 'callback.js', role: 'work', sha256: p.sha256("cy.visit('/different');")},
            {name: 'hook-0.js', role: 'work', sha256: p.sha256(hookSource)}
        ]
    };
    const cbMismatch = p.reconcileWorkloadInputs(callbackMismatchStatic, nativeSnapshot);
    assert.equal(cbMismatch.matched, false);
    assert.equal(cbMismatch.callbackMatch, false);
});

test('workload representation characterizes request paths, separates simulator vs external domains, and reports opaque work', () => {
    const {representWorkload, WORKLOAD_REPRESENTATION_VERSION} = require('../branching/predictor/index.cjs');

    const sources = [
        {
            name: 'work.js',
            role: 'work',
            source: `
                cy.visit('/checkout');
                cy.request('POST', '/api/order', { items: [1, 2, 3] });
                cy.request('GET', 'http://simulator.local:8080/wiremock/payment');
                cy.request('POST', 'https://api.external-gateway.com/v1/charge');
                cy.task('seed');
                cy.task('reindex');
                cy.get('button#place-order').click();
                expect(true).to.be.true;
            `
        }
    ];

    const rep = representWorkload(sources, {
        timingBoundary: 'cypress-test-duration-minus-preparation/v2',
        knownTasks: new Set(['seed']),
        simulatorOrigins: ['http://simulator.local:8080']
    });

    assert.equal(rep.schemaVersion, WORKLOAD_REPRESENTATION_VERSION);
    assert.ok(rep.summary.totalBoundaries >= 7);
    assert.equal(rep.summary.hasOpaqueWork, true);

    // Navigation
    const nav = rep.boundaries.find(b => b.kind === 'navigation');
    assert.ok(nav);
    assert.equal(nav.target, '/checkout');
    assert.equal(nav.domain, 'internal_application');
    assert.equal(nav.subsystem, 'server_rendering');
    assert.equal(nav.represented, false);
    assert.equal(nav.opacityReason, 'server_side_rendering');

    // Internal API
    const apiOrder = rep.boundaries.find(b => b.kind === 'api_request' && b.target === '/api/order');
    assert.ok(apiOrder);
    assert.equal(apiOrder.method, 'POST');
    assert.equal(apiOrder.domain, 'internal_application');
    assert.equal(apiOrder.represented, false);
    assert.ok(apiOrder.prerunInfo.payloadBytes > 0);

    // Local simulator vs external provider
    const simApi = rep.boundaries.find(b => b.kind === 'api_request' && b.target.includes('simulator.local'));
    assert.ok(simApi);
    assert.equal(simApi.domain, 'local_simulator');

    const extApi = rep.boundaries.find(b => b.kind === 'api_request' && b.target.includes('external-gateway.com'));
    assert.ok(extApi);
    assert.equal(extApi.domain, 'external_provider');

    // Runner tasks: resolved vs opaque
    const seedTask = rep.boundaries.find(b => b.kind === 'runner_task' && b.target === 'seed');
    assert.ok(seedTask);
    assert.equal(seedTask.subsystem, 'database');
    assert.equal(seedTask.represented, true); // knownTask

    const reindexTask = rep.boundaries.find(b => b.kind === 'runner_task' && b.target === 'reindex');
    assert.ok(reindexTask);
    assert.equal(reindexTask.subsystem, 'search_indexing');
    assert.equal(reindexTask.represented, false); // not in knownTasks
    assert.equal(reindexTask.opacityReason, 'opaque_runner_task');

    // Client work
    const clientWork = rep.boundaries.find(b => b.kind === 'browser_client' && b.target === 'click');
    assert.ok(clientWork);
    assert.equal(clientWork.represented, true);
    assert.equal(clientWork.opacityReason, null);

    // Provider domains and subsystems summary
    assert.equal(rep.summary.providerDomains.local_simulator, 1);
    assert.equal(rep.summary.providerDomains.external_provider, 1);
    assert.ok(rep.summary.subsystems.database >= 1);
    assert.ok(rep.summary.subsystems.search_indexing >= 1);
    assert.ok(rep.summary.limitations.length > 0);
});

test('ML planning includes workloadRepresentation in assessment and adds opacity warnings', t => {
    const f = fixture(t);
    const result = assess(f.manifest, { loaded: f.load() });

    assert.ok(result.assessment.workloadRepresentation);
    assert.equal(result.assessment.workloadRepresentation.version, 'workload-representation-v2');
    assert.ok(result.assessment.workloadRepresentation.totalWorkloads > 0);

    // Since fixture contains cy.visit('/cart'), it contains opaque server rendering work
    assert.ok(result.assessment.workloadRepresentation.opaqueWorkloads > 0);
    assert.ok(result.assessment.workloadRepresentation.opaqueCategories.includes('navigation'));

    // Check that test has workload and warning explaining opaque work
    const firstTest = result.assessment.tests.first;
    assert.ok(firstTest.workload);
    assert.ok(firstTest.warnings.some(w => w.includes('Workload contains server-side/runner boundaries')));
    assert.match(firstTest.workload.supportsForecast.dataBasis, /Static call sites/);
    const prefix = result.assessment.stages['cp-cart'];
    assert.deepEqual(prefix.workload.boundaries.filter(item => item.kind === 'navigation').map(item => item.target), ['/cart']);
});


test('input reconciliation does not infer instrumentation from application task names', () => {
    const source = {name:'hook-0.js',role:'work',source:"cy.task('measurement:reindex')",sha256:'same'};
    const result=p.reconcileWorkloadInputs({sources:[source]}, {sources:[source]});
    assert.deepEqual(result.diagnosticHooks,[]);
});


test('provider classification requires the configured simulator origin, including port', () => {
    const {classifyDomain} = require('../branching/predictor/workload-representation.cjs');
    const options = {simulatorOrigins:['http://simulator.local:8080'],applicationOrigins:['https://shop.test']};
    assert.equal(classifyDomain('https://mock-gateway.example.com/pay',options),'external_provider');
    assert.equal(classifyDomain('http://simulator.local:8081/pay',options),'external_provider');
    assert.equal(classifyDomain('http://simulator.local:8080/pay',options),'local_simulator');
    assert.equal(classifyDomain('https://shop.test/pay',options),'internal_application');
    assert.equal(classifyDomain(null,options),'unknown');
});
