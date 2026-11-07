// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execute}=require('./fixtures/branching/engine.cjs');
const {FixtureProvider,fixtureWorkflow}=require('./fixtures/branching/provider.cjs');
class ContinueProvider extends FixtureProvider {
 constructor(){super();this.restores=0;this.resumes=0;}
 async captureBarrier(){await this.barrier();}
 async resumeCapture(){this.resumes++;}
 async restore(directory){this.restores++;await super.restore(directory);if(this.corruptRestore)this.state.files.hiddenLeak='unexpected';}
}
test('original first branches continue while first actual reuse validates restored state',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'b2-continue-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workflow=fixtureWorkflow(),provider=new ContinueProvider();
 const fresh=await execute({workflow,provider:new FixtureProvider(),root,approach:'L0'});
 const result=await execute({workflow,provider,root,approach:'branching'});
 assert.equal(result.status,'passed');assert.equal(result.errors.length,0);
 assert.deepEqual(result.results.map(r=>r.state),fresh.results.map(r=>r.state));
 assert.equal(provider.resumes,4);assert.equal(provider.restores,result.counts.reuseHits);
 assert(result.counts.firstReuseValidations>0);assert(result.checkpoints.every(c=>c.restoreValidation==='first-reuse'));
});
test('first-use semantic validation detects corruption that stage assertions do not cover',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'b2-continue-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const provider=new ContinueProvider();provider.corruptRestore=true;
 const result=await execute({workflow:fixtureWorkflow(),provider,root,approach:'branching'});
 assert(result.counts.fallbacks>0);assert(result.errors.some(e=>e.message.includes('first reuse')));
 assert(result.results.every(r=>!r.state?.files.hiddenLeak),'Corrupted restored state reached a terminal result');
});
