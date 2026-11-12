// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const p=require('../branching/predictor/index.cjs');
const {assess,boundary}=require('../branching/predictor/planning.cjs');
const {assertAssessed,assertExecutable}=require('../branching/estimation.cjs');
function fixture(t) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-ml-plan-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const callback="()=>{cy.visit('/cart');cy.get('button').click();}";
    const source=`// 🛒\nimport {helper} from './helper.js';\ndescribe('cart',()=>{before(()=>helper());it('first',${callback});it('second',${callback});});`;
    const helper="throw new Error('Project source must never execute'); export function helper(){return cy.request('/seed');}";
    fs.writeFileSync(path.join(root,'flow.cy.js'),source);fs.writeFileSync(path.join(root,'helper.js'),helper);
    const tests=[];let offset=0;
    for(const id of ['first','second']) {
        const at=source.indexOf(callback,offset);offset=at+callback.length;
        const bodyStart=source.indexOf("cy.visit('/cart');",at);
        const start=Buffer.byteLength(source.slice(0,bodyStart)),end=start+Buffer.byteLength("cy.visit('/cart');");
        tests.push({id,title:id,file:'flow.cy.js',fixture:'cypress:it',scope:'scope',line:2,callbackStart:Buffer.byteLength(source.slice(0,at)),callbackEnd:Buffer.byteLength(source.slice(0,offset)),steps:[{start,end,kind:'statement'}]});
    }
    const manifest={schemaVersion:1,implementation:'rust-prefix-v3',root,sources:[['flow.cy.js',source],['helper.js',helper]].map(([path,bytes])=>({path,sha256:p.sha256(bytes)})),tests,
        checkpoints:[{id:'cp-cart',depth:1,representative:'first',consumers:['first','second'],automatic:true}],diagnostics:[],assessment:{analysis:{collectionComplete:true}}};
    const width=p.REACHABLE_WIDTH;
    const model={schemaVersion:1,featureSchema:p.REACHABLE_SCHEMA,qualified:true,referenceBaselineMs:106638.8,errorLogP90:0.2,
        estimator:{intercept:Math.log1p(1234),inputTransform:'log1p',mean:Array(width).fill(0),scale:Array(width).fill(1),coefficients:Array(width).fill(0)},
        domains:[{runner:'cypress',unit:'test',timingBoundary:'cypress-test-duration-minus-preparation/v2'}, {runner:'cypress',unit:'prefix',timingBoundary:boundary}].map(d=>({...d,environmentDigest:'fixture',ranges:Array(width).fill([0,1e9])}))};
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
test('whole-test models forecast prefixes with explicit transfer warnings and no heuristic fallback',t=>{
    const f=fixture(t);f.model.domains=f.model.domains.filter(d=>d.unit==='test');
    const result=assess(f.manifest,{loaded:f.load()});
    assert.ok(result.assessment.tests.first.prediction);
    assert.ok(result.assessment.stages['cp-cart'].prediction.ms>0);
    assert.equal(result.assessment.stages['cp-cart'].prediction.domainMatched,false);
    assert.match(JSON.stringify(result.assessment.stages['cp-cart'].warnings),/unvalidated timing boundary/);
    assert.ok(result.assessment.candidates[0].estimatedSegmentMs>0);
    assertAssessed(result);
    assert.throws(()=>assertExecutable(result),error=>error.code==='ESTIMATION_FAILED');
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
test('reachable inherited constructors remain parseable without changing ordinary method features',()=>{
    const {reachableContext}=require('../branching/predictor/reachable.cjs');
    const sources=[{name:'work.js',role:'work',source:'const x = new Adapter(); x.constructor();'},
        {name:'helper.js',role:'context',source:'class Adapter extends Base {constructor(){super();} ordinary(){return 1;}}'}];
    const reachable=reachableContext(sources);assert.ok(reachable.some(s=>s.source.includes('super()')));
    assert.doesNotThrow(()=>p.features({runner:'cypress',unit:'test',sources,featureSchema:p.REACHABLE_SCHEMA}));
});

test('packaged ML planner preserves failures until successful replanning',t=>{
    const {planner}=require('../branching/planner-client.cjs');
    const root=require('./fixtures/branching/planner.cjs').plannerFixture(t,'magelens-ml-cli-',{model:require('./fixtures/branching/predictor.cjs').model(100)});
    const source=path.join(root,'source');fs.mkdirSync(source);
    const file=path.join(source,'flow.cy.js'),output=path.join(root,'plan.json');
    const original="it('one',()=>{cy.visit('/cart');});it('two',()=>{cy.visit('/cart');});";
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
    fs.appendFileSync(path.join(root,'model.json'),' ');
    assert.throws(()=>run('plan',source,output));
    assert.equal(fs.readFileSync(output,'utf8'),saved);
});
