// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execute} = require('./fixtures/branching/engine.cjs');
const {FixtureProvider, fixtureWorkflow} = require('./fixtures/branching/provider.cjs');
const {SchemaDatabase, foreignTransactions} = require('../branching/retained-database.cjs');
const {replaceContents} = require('../branching/storage.cjs');
const {fileDigest} = require('../branching/identity.cjs');
const {RetainedProvider} = require('../branching/retained-provider.cjs');

function temporary(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-retained-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true})); return root;
}
test('nested prefetch follows published ancestors and releases checkpoints after their last consumer', async t => {
    const root = temporary(t), seen = [], provider = new FixtureProvider();
    provider.prefetch = async ({directory, next}) => {
        const state = directory ? JSON.parse(fs.readFileSync(path.join(directory, 'state.json'))) : null;
        seen.push({next, shipping: state?.db.shipping, cart: state?.db.cart});
    };
    const report = await execute({root, workflow: fixtureWorkflow(), provider, checkpointLifetime: 'last-consumer'});
    assert.equal(report.status, 'passed'); assert.equal(report.counts.reuseHits, 2);
    assert.deepEqual(seen, [{next:'coupon-0',shipping:null,cart:['sku-1','sku-2']},
        {next:'coupon-1',shipping:'fixed',cart:['sku-1','sku-2']}]);
    assert.equal(report.releases.length, report.checkpoints.length); assert.equal(fs.existsSync(report.directory), false);
});
test('prefetch respects a cost-selected ancestor instead of an unselected deeper boundary', async t => {
    const provider = new FixtureProvider(), seen = [];
    provider.prefetch = async ({directory}) => seen.push(JSON.parse(fs.readFileSync(path.join(directory, 'state.json'))).db);
    const report = await execute({root: temporary(t), workflow: fixtureWorkflow(), provider,
        checkpointLifetime:'last-consumer', checkpointSelection:['customer-ready']});
    assert.equal(report.status, 'passed'); assert.equal(seen.length, 2);
    assert.ok(seen.every(db => db.customer === 'synthetic' && db.cart.length === 0));
});
test('linear execution prefetches only the baseline and prefix failures do not advance a separate cursor', async t => {
    const workflow = fixtureWorkflow(), provider = new FixtureProvider(), seen = [];
    provider.prefetch = async event => seen.push(event);
    workflow.stages.find(s => s.id === 'shipping-selected').run = async () => { throw new Error('prefix failed'); };
    const report = await execute({root: temporary(t), workflow, provider, approach:'L0'});
    assert.equal(report.status, 'failed'); assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], {directory:null,next:'coupon-0'});
    assert.deepEqual(report.results.map(r => r.status), ['passed','blocked','blocked']);
});
test('only the owned inactive root import is allowed across the database fence', () => {
    const transaction = {schema:'private_b',user:'root',host:'localhost'};
    const policy = {activeSchema:'private_a',target:'private_b',ownedSchemas:['private_a','private_b']};
    assert.deepEqual(foreignTransactions([transaction], policy), []);
    for (const value of [{...transaction,schema:'private_a'}, {...transaction,user:'magento'},
        {...transaction,host:'remote'}, {...transaction,schema:'unowned'}]) {
        assert.deepEqual(foreignTransactions([value], policy), [value]);
    }
    assert.deepEqual(foreignTransactions([transaction], {...policy,activeSchema:'private_b'}), [transaction]);
});
test('restore fallback discards a stale prepared schema before importing the actual ancestor', async t => {
    const root = temporary(t), file = path.join(root, 'snapshot.sql'); fs.writeFileSync(file, 'ancestor SQL');
    const switched = [], backend = {activeSchema:'a',schemas:['a','b'],ownedSchemas:['a','b'],
        diagnostics:{discardedPrefetches:0,prefetchHits:0,importWaitMs:0,importWorkMs:0},switchSchema:s=>switched.push(s)};
    const database = new SchemaDatabase(backend); let imports = 0, settled = false;
    database.job = {target:'b',key:'stale',ms:1,promise:Promise.resolve().then(()=>{settled=true;})};
    database.prefetch = () => { assert.equal(settled,true); imports++; database.job={target:'b',ms:2,promise:Promise.resolve()}; };
    await database.consume(file);
    assert.equal(imports,1); assert.equal(backend.diagnostics.discardedPrefetches,1);
    assert.deepEqual(switched,['b']); assert.equal(database.job,null);
});
test('failed imports never switch schemas and are settled before cleanup', async t => {
    const file = path.join(temporary(t),'snapshot.sql'); fs.writeFileSync(file,'SQL');
    let switched=false; const database=new SchemaDatabase({switchSchema:()=>{switched=true;}});
    const error = new Error('import failed'); database.job={promise:Promise.resolve(),error};
    await assert.rejects(database.consume(file), /import failed/); assert.equal(switched,false);
    assert.equal(await database.settle(),error); assert.equal(database.job,null);
});
test('live directory restoration refuses unowned destinations and symlinked state', t => {
    const root=temporary(t),source=path.join(root,'source'),destination=path.join(root,'destination');
    fs.mkdirSync(source);fs.mkdirSync(destination);fs.symlinkSync('/tmp',path.join(source,'escape'));
    assert.throws(()=>replaceContents(source,destination,root),/Unsupported state file/);
    assert.throws(()=>replaceContents(source,os.tmpdir(),root),/unowned/);
    assert.equal(fs.readdirSync(destination).length,0);
});
test('early preparation follows the next consumer and stops after the last test', async t => {
    const provider = new FixtureProvider(), options = [];
    const restore = provider.restore.bind(provider);
    provider.prefetch = async () => {};
    provider.restore = async (directory, next) => {options.push(next?.prefetch);await restore(directory);};
    const report = await execute({root:temporary(t),workflow:fixtureWorkflow(),provider,checkpointLifetime:'last-consumer'});
    assert.equal(report.status,'passed');
    const restores = options.filter(value=>value !== undefined);
    assert.equal(restores.length,2);
    assert.equal(restores[0].next,'coupon-1');
    assert.equal(restores[1],null,'The final consumer must not start another import');
    assert.equal(report.releases.length,report.checkpoints.length);
});
test('inactive-schema preparation deduplicates a snapshot and settles a different one before replacement', async t => {
    const root=temporary(t),file=path.join(root,'snapshot.sql');fs.writeFileSync(file,'current');
    const database=new SchemaDatabase({diagnostics:{discardedPrefetches:0}});
    let settled=false,imports=0;
    database.job={key:fileDigest(file),promise:Promise.resolve().then(()=>{settled=true;})};
    database.prefetch=()=>{assert.equal(settled,true);imports++;};
    await database.prepare(file);assert.equal(imports,0);
    fs.writeFileSync(file,'new descendant');
    await database.prepare(file);assert.equal(imports,1);
    assert.equal(database.backend.diagnostics.discardedPrefetches,1);
});
test('early import failures propagate for both duplicate and replacement snapshots', async t => {
    const file=path.join(temporary(t),'snapshot.sql');fs.writeFileSync(file,'snapshot');
    for (const key of [fileDigest(file),'different']) {
        const database=new SchemaDatabase({diagnostics:{discardedPrefetches:0}});
        database.job={key,promise:Promise.resolve(),error:new Error('import failed')};
        database.prefetch=()=>assert.fail('A failed import must not be overwritten');
        await assert.rejects(database.prepare(file),/import failed/);
    }
});
test('retained restore starts next preparation after the schema switch and before browser reconstruction', async t => {
    const directory=temporary(t),events=[];
    fs.writeFileSync(path.join(directory,'browser.json'),'{}');
    const provider=Object.create(RetainedProvider.prototype);
    provider.backend={paths:{},drain:async()=>{},stop:async()=>{},resetCaches:async()=>{},start:async()=>events.push('switch')};
    provider.browserState={open:async()=>events.push('browser')};
    provider.prefetch=async options=>{assert.equal(options.next,'next');events.push('prefetch');};
    await provider.restore(directory,{prefetch:{directory,next:'next'}});
    assert.deepEqual(events,['switch','prefetch','browser']);
    events.length=0;await provider.restore(directory);
    assert.deepEqual(events,['switch','browser']);
});
