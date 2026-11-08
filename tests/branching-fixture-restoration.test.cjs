// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test=require('node:test'),assert=require('node:assert/strict');
const {FixtureState}=require('../branching/runners/playwright/fixture-state.cjs');
const recipe={version:1,functions:{
    prepare:{code:'async function prepare(page) {await page.goto("/prepare");}',bindings:{}},
    fixture:{code:'async ({page},use)=>{}',bindings:{prepare:{ref:'prepare'}}},
    dependent:{code:'async ({cart},use)=>{}',bindings:{}},
    body:{code:'async ({cart,ready})=>{if(cart.items.length!==1||ready.cart!==cart)throw new Error("state leaked");cart.items.push("branch");await cart.button.click();}',bindings:{}},
},fixtures:[{name:'cart',function:'fixture',dependencies:['page'],parameters:'{page}',setup:'await prepare(page);const state={items:["seed"],button:page.locator("#order")};',valueExpression:'state',locals:['state'],teardown:'await page.goto("/cleanup/"+state.items.length);'},
    {name:'ready',function:'dependent',dependencies:['cart'],parameters:'{cart}',setup:'',valueExpression:'({cart})',locals:[],teardown:''}],callback:'body'};
const manifest={tests:[{id:'one',scope:'shared',restoration:recipe},{id:'two',scope:'shared',restoration:recipe}]};
function runtime(){const calls=[];let pageSerial=0;const p={calls,context:{},baseURL:'https://example.test/'};p.replace=()=>{const serial=++pageSerial;p.page={goto:async url=>calls.push(url),locator:selector=>({click:async()=>calls.push(`click:${serial}:${selector}`)})};};p.replace();return p;}
test('fixture snapshots preserve aliases, reconnect locators and run each consumer teardown',async()=>{
    const state=new FixtureState(manifest,{expect:assert});const p=runtime();
    await state.prepare(manifest.tests[0],p);const snapshot=JSON.parse(JSON.stringify(state.capture(p)));
    await state.run(manifest.tests[0],p);assert.equal(state.capture(p),null);
    p.replace();await state.restore(snapshot,p);await state.run(manifest.tests[1],p);
    assert.deepEqual(p.calls,['/prepare','click:1:#order','/cleanup/2','click:2:#order','/cleanup/2']);
});
test('fixture cleanup runs after test failure and teardown errors remain failures',async()=>{
    const altered=structuredClone(manifest);altered.tests[0].restoration.functions.body.code='async()=>{throw new Error("test failed")}';
    altered.tests.length=1;
    altered.tests[0].restoration.fixtures[0].teardown='throw new Error("cleanup failed")';
    const state=new FixtureState(altered,{expect:assert}),p=runtime();await state.prepare(altered.tests[0],p);
    await assert.rejects(state.run(altered.tests[0],p),e=>e instanceof AggregateError&&e.errors.some(e=>e.message==='test failed')&&e.errors.some(e=>e.message==='cleanup failed'));
    assert.equal(state.capture(p),null);
});
test('unsupported live handles fail before publishing a fixture checkpoint',async()=>{
    const altered=structuredClone(manifest);altered.tests[0].restoration.fixtures[0].valueExpression='({callback:()=>42})';
    const state=new FixtureState(altered,{expect:assert}),p=runtime();
    await assert.rejects(state.prepare(altered.tests[0],p),/Cannot checkpoint.*function/);
    assert.equal(state.capture(p),null);assert.ok(p.calls.includes('/cleanup/1'));
});

test('fixture frames preserve cyclic data, class prototypes and TypeScript locals',async()=>{
    const altered=structuredClone(manifest);altered.tests.length=1;const r=altered.tests[0].restoration;
    r.functions.Cart={code:'class Cart { constructor(page) {this.page=page;this.items=["seed"];} size(): number {return this.items.length;} }',bindings:{}};
    r.functions.fixture.bindings.Cart={ref:'Cart'};
    r.fixtures[0].setup='await prepare(page);const state: any=new Cart(page);state.self=state;state.map=new Map([[state,"saved"]]);state.date=new Date("2026-01-01");state.missing=undefined;state.amount=12n;';
    r.functions.body={code:'async({cart})=>{if(cart.self!==cart||cart.map.get(cart)!=="saved"||cart.size()!==1||cart.amount!==12n||cart.date.toISOString()!=="2026-01-01T00:00:00.000Z")throw new Error("corrupted frame");cart.items.push("branch");}',bindings:{}};
    const state=new FixtureState(altered,{expect:assert}),p=runtime();await state.prepare(altered.tests[0],p);
    const snapshot=JSON.parse(JSON.stringify(state.capture(p)));await state.run(altered.tests[0],p);
    p.replace();await state.restore(snapshot,p);await state.run(altered.tests[0],p);
    assert.equal(p.calls.filter(c=>c==='/prepare').length,1);
    assert.equal(p.calls.filter(c=>c==='/cleanup/2').length,2);
});

test('locator options and regular expressions are hydrated before reconnecting handles',()=>{
    const {FixtureCodec}=require('../branching/runners/playwright/fixture-values.cjs');
    const observed=[];const p={page:{getByRole:(role,options)=>{observed.push([role,options.name.source]);return {click(){}};}}};
    const factory={prototypes:new Map()};const codec=new FixtureCodec(p,factory),options={name:/Place order/i};
    const locator=codec.handle('page').getByRole('button',options);options.name=/Changed/;
    const snapshot=codec.encode({locator,frozen:Object.freeze(['fixed'])});
    const restored=new FixtureCodec(p,factory).decode(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(typeof restored.locator.click,'function');assert.equal(Object.isFrozen(restored.frozen),true);
    assert.deepEqual(observed,[['button','Place order'],['button','Place order']]);
});

test('fixture browser references retain identity through public page and context APIs',()=>{
    const {FixtureCodec}=require('../branching/runners/playwright/fixture-values.cjs');
    const request={},runtime={page:{},context:{request}};runtime.context.pages=()=>[runtime.page];runtime.page.locator=()=>({page:()=>runtime.page});
    const codec=new FixtureCodec(runtime,{prototypes:new Map()}),page=codec.handle('page');
    assert.equal(page.context().pages()[0],page);
    assert.equal(page.locator('button').page(),page);
    assert.equal(page.request,page.context().request);
});

test('Rust AUTO restores real fixture frames through checkpoint inventory and last-consumer cleanup',async t=>{
    const fs=require('node:fs'),path=require('node:path');
    const {planner}=require('../branching/planner-client.cjs');
    const {buildWorkflow}=require('../branching/automatic.cjs');
    const {execute}=require('../branching/engine.cjs');
    const {FixtureProvider}=require('./fixtures/branching/provider.cjs');
    const root=require('./fixtures/branching/planner.cjs').plannerFixture(t,'magelens-fixture-continuation-');
    const source=path.join(root,'source');fs.mkdirSync(source);
    fs.writeFileSync(path.join(source,'journey.spec.ts'),`import {test as base} from '@playwright/test';
        async function prepare(page){for(let i=0;i<500;i++)await page.goto('/prepare');}
        const test=base.extend({cart:async({page},use)=>{await prepare(page);const state={page,items:['seed'],button:page.locator('#order')};try{await use(state);}finally{await page.goto('/cleanup/'+state.items.length);}}});
        test('one',async({cart})=>{if(cart.items.length!==1)throw new Error('leaked');cart.items.push('one');await cart.button.click();});
        test('two',async({cart})=>{if(cart.items.length!==1)throw new Error('leaked');cart.items.push('two');await cart.button.click();});
        test('empty',async({cart})=>{});`);
    const manifestFile=path.join(root,'manifest.json');planner(['plan',source,manifestFile],{stdio:'pipe'});
    const manifest=JSON.parse(fs.readFileSync(manifestFile));assert.ok(manifest.tests.every(t=>t.restoration));
    class Provider extends FixtureProvider {
        constructor(){super();this.calls=[];this.pageSerial=0;}
        replace(){const serial=++this.pageSerial;this.page={goto:async url=>{this.state.browser.url=url;this.calls.push(url);},locator:selector=>({click:async()=>this.calls.push(`click:${serial}:${selector}`)})};this.context={};}
        async reset(){await super.reset();this.replace();}
        async restore(directory){await super.restore(directory);this.replace();}
    }
    const provider=new Provider();
    const built=buildWorkflow(manifest,{identity:'fixture-frame-integration',expect:assert,state:async p=>p.normalizedState(),assertCheckpoint:async p=>assert.equal(p.state.browser.url,'/prepare')});
    const report=await execute({...built,root,provider});
    assert.equal(report.status,'passed',JSON.stringify(report.errors));assert.equal(report.checkpoints.length,1);
    assert.equal(report.counts.reuseHits,2);assert.equal(report.counts.fallbacks,0);
    assert.equal(provider.calls.filter(c=>c==='/prepare').length,500,'Setup executes once across both siblings');
    assert.equal(provider.calls.filter(c=>c==='/cleanup/2').length,2,'Teardown executes for each consumer');
    assert.equal(provider.calls.filter(c=>c==='/cleanup/1').length,1,'An empty test still runs its fixture teardown');
    assert.equal(new Set(provider.calls.filter(c=>c.startsWith('click:'))).size,2,'Restored locator uses the replacement page');
    assert.ok(report.checkpoints[0].artifacts.some(a=>a.path==='runner-state.json'));
    assert.equal(report.releases.length,1);assert.equal(fs.existsSync(report.directory),false);
});
