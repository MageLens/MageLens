// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {assessed, estimate} = require('./fixtures/branching/assessment.cjs');
const os = require('node:os');
const path = require('node:path');
const {buildWorkflow, compileFragment} = require('../branching/automatic.cjs');
const {execute, fileDigest, CheckpointStore, digest} = require('./fixtures/branching/engine.cjs');
const {FixtureProvider, fixtureWorkflow} = require('./fixtures/branching/provider.cjs');

function fixture(t) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-automatic-'));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const source="// 🛒 UTF-8 offsets\nawait page.goto('/cart');\nawait page.goto('/one');\nawait page.goto('/two');";
    fs.writeFileSync(path.join(root,'flow.spec.ts'),source);
    const steps=["await page.goto('/cart');","await page.goto('/one');","await page.goto('/two');"].map(code=>{
        const start=Buffer.byteLength(source.slice(0,source.indexOf(code)));return {start,end:start+Buffer.byteLength(code),kind:'statement',portable:true,actionUnits:1};
    });
    const tests=['test-one','test-two'].map((id,i)=>({id,file:'flow.spec.ts',title:id,line:2,scope:'same-scope',disposition:'automatic',reasons:[],steps:[steps[0],steps[i+1]]}));
    const checkpoint={id:'cp-cart',depth:1,parent:null,representative:tests[0].id,consumers:tests.map(t=>t.id),automatic:true};
    const manifest={schemaVersion:1,implementation:'rust-prefix-v1',root,sourceDigest:'source',sources:[{path:'flow.spec.ts',sha256:fileDigest(path.join(root,'flow.spec.ts'))}],
        tests,checkpoints:[checkpoint],schedule:tests.map(t=>t.id),diagnostics:[]};
    const configuration={identity:'same-customer',expect:assert,state:async p=>p.normalizedState(),assertCheckpoint:async p=>assert.equal(p.state.browser.url,'/cart')};
    class Provider extends FixtureProvider {
        get page(){return {goto:async url=>{this.state.browser.url=url;this.hit(url);if(url==='/cart')this.state.db.cart=['sku'];}};}
    }
    assessed(manifest);
    return {root,manifest,configuration,Provider};
}

test('compiled fragments preserve strict module semantics',async()=>{
    assert.equal(await compileFragment([], 'return this;')(),undefined);
    await assert.rejects(compileFragment([], 'unboundAutomaticTestVariable = 1;')(),ReferenceError);
});

test('Cypress fragments use their own queue with original UTF-8 source bytes', async t => {
    const {root, manifest, configuration} = fixture(t);
    const source = "// 🛒\ncy.visit('/cart');\ncy.visit('/one');\ncy.visit('/two');";
    const file = path.join(root, 'flow.spec.ts'); fs.writeFileSync(file, source);
    manifest.sources[0].sha256 = fileDigest(file);
    for (const [index, item] of manifest.tests.entries()) {
        item.fixture = 'cypress:it';
        item.steps = ["cy.visit('/cart');", `cy.visit('/${index ? 'two' : 'one'}');`].map(code => {
            const start = Buffer.byteLength(source.slice(0, source.indexOf(code)));
            return {start, end: start + Buffer.byteLength(code), kind: 'statement', portable: true, actionUnits: 1};
        });
    }
    assessed(manifest);
    const built = buildWorkflow(manifest, configuration), executed = [];
    const runtime = {executeCypress: async code => executed.push(code)};
    await built.workflow.stages.get('cp-cart').run(runtime);
    await built.workflow.specs.get('test-two').run(runtime);
    assert.deepEqual(executed, ["cy.visit('/cart');", "cy.visit('/two');"]);
});

test('automatic fragments preserve UTF-8, branch states and last-consumer cleanup',async t=>{
    const {root,manifest,configuration,Provider}=fixture(t);
    const built=buildWorkflow(manifest,configuration);
    const branching=await execute({...built,root,provider:new Provider()});
    const l0=await execute({...built,root,provider:new Provider(),approach:'L0'});
    assert.equal(branching.status,'passed',JSON.stringify(branching.errors));assert.equal(l0.status,'passed');
    assert.equal(branching.counts.reuseHits,1);assert.equal(branching.checkpoints.length,1);
    assert.deepEqual(branching.results.map(r=>r.state),l0.results.map(r=>r.state));
    assert.deepEqual(branching.releases.map(r=>[r.stage,r.after]),[['cp-cart','test-two']]);
    assert.equal(fs.existsSync(branching.directory),false);
});

test('single selected branch avoids creating a checkpoint with no future consumer',async t=>{
    const {root,manifest,configuration,Provider}=fixture(t);
    const built=buildWorkflow(manifest,configuration,['test-two']);
    const report=await execute({...built,root,provider:new Provider()});
    assert.equal(report.status,'passed');assert.equal(report.checkpoints.length,0);assert.equal(report.results.length,1);
});

test('unsupported fixture, missing assertion, stale dependencies and dynamic tests stop before launch',t=>{
    const {root,manifest,configuration}=fixture(t);
    manifest.tests[0].disposition='adapter-required';manifest.tests[0].reasons=['Authenticated fixture'];
    assert.throws(()=>buildWorkflow(manifest,configuration),/Authenticated fixture/);
    manifest.tests[0].disposition='automatic';
    assert.throws(()=>buildWorkflow(manifest,{...configuration,assertCheckpoint:null}),/assertCheckpoint/);
    manifest.diagnostics.push('dynamic tests');assert.throws(()=>buildWorkflow(manifest,configuration),/Cost assessment failed/);
    assert.throws(()=>buildWorkflow(manifest,configuration,['test-one']),error=>error.statusCode===500);manifest.diagnostics=[];
    fs.appendFileSync(path.join(root,'flow.spec.ts'),'\n//changed');assert.throws(()=>buildWorkflow(manifest,configuration),/Stale source/);
});

test('invalid selections and syntax are rejected before provider preparation',t=>{
    const {root,manifest,configuration}=fixture(t);
    assert.throws(()=>buildWorkflow(manifest,configuration,['missing']),/Unknown test/);
    assert.throws(()=>buildWorkflow(manifest,configuration,['test-one','test-one']),/Duplicate/);
    const file=path.join(root,'flow.spec.ts');fs.writeFileSync(file,'await (');
    manifest.sources[0].sha256=fileDigest(file);manifest.tests[0].steps=[{start:0,end:7}];manifest.checkpoints=[];assessed(manifest);
    assert.throws(()=>buildWorkflow(manifest,configuration,['test-one']),SyntaxError);
});

test('failed last consumer still releases its snapshot and records failure',async t=>{
    const {root,manifest,configuration,Provider}=fixture(t);
    const built=buildWorkflow(manifest,configuration);
    built.workflow.specs.get('test-two').run=async()=>{throw new Error('suffix failure');};
    const report=await execute({...built,root,provider:new Provider()});
    assert.equal(report.status,'failed');assert.equal(report.releases.length,1);assert.equal(fs.existsSync(report.directory),false);
});

test('ancestor remains available for a later sibling after a deeper subtree finishes',async t=>{
    const {root}=fixture(t);const workflow=fixtureWorkflow({fanout:2});
    const report=await execute({root,workflow,provider:new FixtureProvider(),checkpointLifetime:'last-consumer',specs:['coupon-0','coupon-1','remove-item']});
    assert.equal(report.status,'passed');
    assert.equal(report.releases.find(r=>r.stage==='shipping-selected').after,'coupon-1');
    assert.equal(report.releases.find(r=>r.stage==='cart-ready').after,'remove-item');
    assert.equal(report.counts.reuseHits,2);
});

test('checkpoint release refuses unowned metadata and symlink directories',t=>{
    const {root}=fixture(t);const dir=path.join(root,'checkpoint');fs.mkdirSync(dir);
    const manifest={owner:'other',id:'id'};fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
    const store=new CheckpointStore(root,'owner','profile');store.available.set('stage',{id:'id',directory:dir,digest:digest(manifest)});
    assert.throws(()=>store.release('stage'),/Unowned/);assert.equal(fs.existsSync(dir),true);
    const link=path.join(root,'link');fs.symlinkSync(dir,link);store.available.set('stage',{id:'id',directory:link,digest:digest(manifest)});
    assert.throws(()=>store.release('stage'),/Unowned/);
});

test('retained evidence suppresses last-consumer deletion',async t=>{
    const {root,manifest,configuration,Provider}=fixture(t);
    const report=await execute({...buildWorkflow(manifest,configuration),root,provider:new Provider(),retain:true});
    assert.equal(report.status,'passed');assert.equal(report.releases.length,0);assert.equal(fs.existsSync(report.directory),true);
});


test('Rust source estimates are authoritative and never call handwritten weight callbacks',t=>{
    const {manifest,configuration}=fixture(t);
    manifest.implementation='rust-prefix-v2';
    assessed(manifest);
    for(const entry of manifest.tests) {
        entry.fixtureEstimate={...estimate(20),points:20,estimatedPoints:20,lowerBoundPoints:2,complete:false};
        for(const step of entry.steps) step.estimate={...estimate(8),points:8,estimatedPoints:8,lowerBoundPoints:1,complete:false};
    }
    const adapter={identity:'execution-only',supports:()=>true,execute:async()=>{},prepare:async()=>{},
        fixtureUnits:()=>{throw new Error('Handwritten fixture cost must not run');},
        actionUnits:()=>{throw new Error('Handwritten step cost must not run');}};
    for(const config of [configuration,{...configuration,adapter}]) {
        const workflow=buildWorkflow(manifest,config).workflow;
        assert.equal([...workflow.stages.values()].find(s=>s.checkpoint===false).actionUnits,20);
        assert.equal(workflow.stages.get('cp-cart').actionUnits,8);
    }
    manifest.tests[0].steps[0].estimate.complete=false;
    assert.equal(buildWorkflow(manifest,configuration).workflow.stages.get('cp-cart').actionUnits,8);
    manifest.tests[0].steps[0].estimate={points:8,estimatedPoints:-1,lowerBoundPoints:1,complete:false};
    assert.throws(()=>buildWorkflow(manifest,configuration),/Cost assessment failed/);
});

test('outdated source cost models require replanning before workflow construction',t=>{
    const {manifest,configuration}=fixture(t);manifest.implementation='rust-prefix-v2';
    for(const assessment of [{version:'js-ts-points-v1'}, {version:'js-ts-points-v2',boundsVersion:1}, {version:'js-ts-points-v3',boundsVersion:1}]) {
        manifest.assessment=assessment;
        assert.throws(()=>buildWorkflow(manifest,configuration),/cost model.*replan/i);
    }
});
