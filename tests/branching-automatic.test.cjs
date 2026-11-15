// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {assessed} = require('./fixtures/branching/assessment.cjs');
const os = require('node:os');
const path = require('node:path');
const {buildWorkflow, compileFragment, playwrightCoverageAdapter} = require('../branching/automatic.cjs');
const {execute, fileDigest, CheckpointStore, digest} = require('./fixtures/branching/engine.cjs');
const {FixtureProvider, fixtureWorkflow} = require('./fixtures/branching/provider.cjs');

function fixture(t) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-automatic-'));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const source="// 🛒 UTF-8 offsets\nawait page.goto('/cart');\nawait page.goto('/one');\nawait page.goto('/two');";
    fs.writeFileSync(path.join(root,'flow.spec.ts'),source);
    const steps=["await page.goto('/cart');","await page.goto('/one');","await page.goto('/two');"].map(code=>{
        const start=Buffer.byteLength(source.slice(0,source.indexOf(code)));return {start,end:start+Buffer.byteLength(code),kind:'statement',portable:true,estimatedMs:1};
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

test('coverage replay requires verified support and resolves all bindings before routing', async t => {
    const {manifest} = fixture(t);
    const dependencies = ['playwright/support.cjs', 'playwright/coverage-cookie.cjs',
        'playwright/javascript-coverage.cjs', 'bin/browser-navigation.cjs'];
    for (const file of dependencies) {
        const source = path.resolve(__dirname, '..', file);
        const target = path.join(manifest.root, file);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.copyFileSync(source, target);
        manifest.sources.push({path: file, sha256: fileDigest(target)});
    }
    const [entry] = manifest.tests;
    const file = path.join(manifest.root, entry.file);
    const imports = "import {test, expect} from './playwright/support.cjs';\n";
    function setBody(body) {
        fs.writeFileSync(file, imports + body);
        manifest.sources.find(source => source.path === entry.file).sha256 = fileDigest(file);
        entry.steps = [{start: Buffer.byteLength(imports), end: Buffer.byteLength(imports + body),
            kind: 'statement', portable: true}];
    }
    Object.assign(entry, {fixture: './playwright/support.cjs:test', parameters: '( { page } )',
        contextFiles: [entry.file, ...dependencies], reasonCodes:['custom-fixture','project-imports'], reasons: [
            'Custom fixture lifecycle is not equivalent to a bare page',
            'Project imports or custom fixtures require an execution adapter'
        ]});
    setBody("await page.goto('/cart');");
    entry.reasons=['Diagnostic wording can change'];
    const adapter = playwrightCoverageAdapter(manifest, assert);
    assert.equal(adapter.supports(entry), true);
    const codes=entry.reasonCodes;entry.reasonCodes=[...codes,'runner-lifecycle'];
    assert.equal(adapter.supports(entry),false);entry.reasonCodes=codes;
    adapter.prepareFragments(entry,[0,1]);
    fs.unlinkSync(file); // Execution must use the already prepared fragment.
    const routes = [];
    await adapter.execute(entry, 0, 1, {page: {goto: async url => routes.push(url)}});
    assert.deepEqual(routes, ['/cart']);
    setBody("const response = await page.goto('/robots.txt'); expect(response.status()).toBe(200);");
    entry.steps[0].portable = false;
    const wholeTest = playwrightCoverageAdapter(manifest);
    assert.equal(wholeTest.supports(entry), false);
    assert.equal(wholeTest.supportsOrdering(entry), true);
    setBody('await page.goto(moduleRoute);');
    assert.equal(playwrightCoverageAdapter(manifest).supports(entry), false);
    assert.equal(playwrightCoverageAdapter(manifest).supportsOrdering(entry), false);
    setBody("await page.goto('/cart');");
    manifest.sources.find(source => source.path === dependencies[0]).sha256 = '0'.repeat(64);
    assert.equal(playwrightCoverageAdapter(manifest).supports(entry), false);
});

test('compiled fragments preserve strict module semantics',async()=>{
    assert.equal(await compileFragment([], 'return this;')(),undefined);
    await assert.rejects(compileFragment([], 'unboundAutomaticTestVariable = 1;')(),ReferenceError);
});

test('fixture checkpoint times setup instead of a no-op after root preparation', async t => {
    const {manifest, configuration} = fixture(t);
    const calls = [];
    const runtime = {page:{goto:async url=>calls.push(url)}};
    const checkpoint = manifest.checkpoints[0];
    checkpoint.depth = 0;
    for (const entry of manifest.tests) {
        entry.restoration = {
            version:1,
            functions:{body:{code:'async()=>{}',bindings:{}},setup:{code:'async()=>{}',bindings:{}}},
            fixtures:[{name:'ready',function:'setup',dependencies:['page'],parameters:'{page}',
                setup:'await page.goto("/prepare");',valueExpression:'true',locals:[],teardown:''}],
            callback:'body'
        };
    }
    const {workflow} = buildWorkflow(manifest, configuration);
    const stage = workflow.stages.get(checkpoint.id);
    await workflow.stages.get(stage.parent).run(runtime);
    assert.deepEqual(calls, []);
    await stage.run(runtime);
    assert.deepEqual(calls, ['/prepare']);

    const single = buildWorkflow(manifest, configuration, [manifest.tests[0].id]).workflow;
    const spec = single.specs.get(manifest.tests[0].id);
    assert.equal(single.stages.get(spec.parent).estimatedMs,undefined);
    await single.stages.get(spec.parent).run(runtime);
    assert.deepEqual(calls, ['/prepare', '/prepare']);
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
            return {start, end: start + Buffer.byteLength(code), kind: 'statement', portable: true, estimatedMs: 1};
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


test('workflow construction needs no duration forecasts', t => {
    const {manifest, configuration} = fixture(t);
    const {workflow} = buildWorkflow(manifest, configuration);
    assert.ok([...workflow.stages.values()].every(stage => stage.estimatedMs === undefined));
});
test('outdated duration models require replanning before workflow construction',t=>{
    const {manifest,configuration}=fixture(t);manifest.implementation='rust-prefix-v2';
    for(const assessment of [{version:'retired'}, {version:'ml-duration-v1',status:'incomplete'}]) {
        manifest.assessment=assessment;
        assert.throws(()=>buildWorkflow(manifest,configuration),error => error.issues?.some(issue => /Replan/.test(issue.message)));
    }
});

test('shared preparation preserves UTF-8 ranges and TypeScript in cached fragments', async t=>{
    const {root,manifest}=fixture(t),file=path.join(root,'flow.spec.ts');
    const prefix='// 🛒\n',code="await page.goto(('/cart' as string));";
    fs.writeFileSync(file,prefix+code);
    const entry={id:'typed',file:'flow.spec.ts',steps:[{start:Buffer.byteLength(prefix),end:Buffer.byteLength(prefix+code)}]};
    const prepared=require('../branching/fragments.cjs').fragments(manifest);
    prepared.prepare(entry,[0,1]);fs.unlinkSync(file);
    const seen=[];await prepared.execute(entry,0,1,{page:{goto:async url=>seen.push(url)}},assert);
    assert.deepEqual(seen,['/cart']);
});
test('Rust discovery routes both mobile-prefix consumers through the complete native lifecycle',async t=>{
    const root=require('./fixtures/branching/planner.cjs').plannerFixture(t,'magelens-mobile-prefix-');
    const source=path.join(root,'source');fs.mkdirSync(source);
    for(const file of ['playwright/support.cjs','playwright/coverage-cookie.cjs','playwright/javascript-coverage.cjs','bin/browser-navigation.cjs']){
        const target=path.join(source,file);fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.copyFileSync(path.resolve(__dirname,'..',file),target);
    }
    const file=path.join(source,'mobile.spec.ts');
    fs.writeFileSync(file,`import {test,expect} from './playwright/support.cjs';
        test('first',async({page})=>{await page.setViewportSize({width:375,height:812});await page.goto('/cart');await expect(page).toHaveURL('/cart');});
        test('second',async({page})=>{await page.setViewportSize({width:375,height:812});await page.goto('/cart');await expect(page).toHaveURL('/cart');});`);
    const output=path.join(root,'manifest.json');
    require('../branching/planner-client.cjs').planner(['plan',source,output],{stdio:'pipe'});
    const manifest=JSON.parse(fs.readFileSync(output)),adapter=playwrightCoverageAdapter(manifest,assert);
    assert.equal(manifest.tests.length,2);
    assert.ok(manifest.tests.every(entry=>!adapter.supports(entry)));
    const tests=manifest.tests.map(entry=>({...entry,file:path.join(source,entry.file),expectedStatus:'passed',project:'browser'}));
    const executed=[];
    const runner={collect:async()=>({tests,errors:[],exitCode:0,config:{projects:[{name:'browser'}]}}),
        run:async(_config,_directory,{tests:selected=tests})=>{
            executed.push(...selected.map(entry=>entry.id));
            return {tests:selected,results:selected.map(entry=>({id:entry.id,status:'passed'})),status:'passed',exitCode:0,errors:[]};
        }};
    const report=await require('../branching/suite.cjs').runSuite({manifest,directory:path.join(root,'run'),runner,
        project:{identity:'mobile',state:async()=>({}),assertCheckpoint:async()=>{},adapter,native:{config:'config',splitSafe:true}},
        runCheckpoint:async()=>assert.fail('Unsupported viewport state must not reach checkpoint execution')});
    assert.equal(report.status,'passed');assert.equal(report.routing.checkpoint.length,0);
    assert.deepEqual(executed,tests.map(entry=>entry.id));
});
