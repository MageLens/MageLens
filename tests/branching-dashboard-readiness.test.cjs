// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {observeSuite}=require('../branching/suite-observation.cjs');
const {createJournalReader}=require('../branching/dashboard/journal-reader.cjs');
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-journal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('suite journal publishes the complete inventory once and grows linearly with outcomes',async t=>{
 const root=temporary(t),sizes=[];
 for(const count of [600,1200]){
  const observer=observeSuite({eventDirectory:root});
  const tests=Array.from({length:count},(_,i)=>({id:`test-${i}`,title:`Catalog test ${i}`,file:'/project/cypress/e2e/catalog.cy.js',line:i+1}));
  const prepared={inventory:{tests},blocks:[],ordering:{scheduled:tests.map(t=>t.id),changed:false}};
  observer.discover(prepared);
  assert.throws(()=>observer.discover(prepared),/already been published/);
  observer.emit('run-ready');
  for(const test of tests){observer.emit('spec-start',{node:test.id});observer.emit('spec-end',{node:test.id,status:'passed'});}
  await observer.finish({status:'passed'});
  const bytes=fs.readFileSync(path.join(root,observer.run+'.ndjson'));
  const events=bytes.toString().trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(e=>e.type==='discovery-complete').length,1);
  assert.equal(events.filter(e=>e.type==='spec-end').length,count);
  const discovery=events.find(e=>e.type==='discovery-complete');
  assert.deepEqual(discovery.schedule,tests.map(t=>t.id));
  assert.deepEqual(discovery.ordering,{changed:false});
  assert.ok(bytes.length<1024*1024,'Inventory and outcomes must stay compact');sizes.push(bytes.length);
 }
 assert.ok(sizes[1]/sizes[0]<2.1,'Doubling the suite must not duplicate growing graph snapshots');
 const captured=[],observer=observeSuite({onEvent:event=>captured.push(event)});
 const tests=[{id:'a',title:'A'},{id:'b',title:'B'}];
 observer.discover({inventory:{tests},blocks:[],ordering:{basis:'independent-page-project',scheduled:['b','a'],changed:true}});
 await observer.finish({status:'passed'});
 const discovery=captured.find(event=>event.type==='discovery-complete');
 assert.deepEqual(discovery.schedule,['b','a']);
 assert.deepEqual(discovery.ordering,{basis:'independent-page-project',changed:true,original:['a','b']});
});
test('journal tailing waits for complete UTF-8 lines and handles replacement',async t=>{
 const root=temporary(t),run=randomUUID(),file=path.join(root,run+'.ndjson');
 const event=(sequence,type,data)=>JSON.stringify({schemaVersion:1,run,sequence,time:sequence,type,...data})+'\n';
 const first=event(1,'run-start',{nodes:[],schedule:[]});fs.writeFileSync(file,first);
 const updates=[],reader=createJournalReader({directory:root,revisionFiles:[],onUpdate:u=>updates.push(u)});t.after(()=>reader.close());
 await reader.scan();
 const next=Buffer.from(event(2,'run-phase',{phase:'Préparation ✓'})),split=next.indexOf(0xc3)+1;
 fs.appendFileSync(file,next.subarray(0,split));await reader.scan();
 assert.equal(reader.snapshot().runs[0].sequence,1);
 fs.appendFileSync(file,next.subarray(split));await reader.scan();
 assert.equal(reader.snapshot().runs[0].phase,'Préparation ✓');
 assert.equal(updates.at(-1).journals[0].from,first.length);
 fs.writeFileSync(file,first+event(2,'run-phase',{phase:'ready'}));await reader.scan();
 assert.equal(reader.snapshot().runs[0].phase,'ready');
 assert.equal(updates.at(-1).journals[0].from,0);
 assert.deepEqual(reader.snapshot().warnings,[]);
});
test('provider preparation failure never publishes execution readiness',async t=>{
 const {execute}=require('../branching/engine.cjs'),{FixtureProvider,fixtureWorkflow}=require('./fixtures/branching/provider.cjs');
 const provider=new FixtureProvider();provider.prepare=async()=>{throw Error('Preparation failed');};
 const events=[],report=await execute({root:temporary(t),workflow:fixtureWorkflow(),provider,onEvent:event=>events.push(event)});
 assert.equal(report.status,'failed');assert.ok(!events.some(e=>e.type==='run-ready'));
});
