// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');
const {WarmBackend,WarmProvider}=require('./backend.cjs');
const {LiveServerBackend:PrefetchBackend,PrefetchProvider}=require('./live-server.cjs');
const {workflow,hostOwner}=require(path.resolve(__dirname,'../../..')+'/tests/fixtures/branching/checkout-journeys.cjs');
const {assertNoOrders}=require(path.resolve(__dirname,'../../..')+'/tests/fixtures/branching/checkout-state.cjs');
const {execute,Graph}=require(path.resolve(__dirname,'../../..')+'/branching/engine.cjs');
async function main(){
 const [workspace,root,variant,...selected]=process.argv.slice(2);assert.equal(variant,'two-schema-prefetch');
 const marker=JSON.parse(fs.readFileSync(path.join(workspace,'.runtime/experience-owner.json')));assert.equal(marker.purpose,'isolated branching experience validation');
 assert.ok(!fs.existsSync(path.join(workspace,'.runtime/workflow.lock'))&&!fs.existsSync(path.join(workspace,'.runtime/branching-recovery.json')));
 const Backend=variant==='two-schema-prefetch'?PrefetchBackend:WarmBackend;
 const Provider=variant==='two-schema-prefetch'?PrefetchProvider:WarmProvider;
 const backend=new Backend({workspace,helperImage:process.env.MAGELENS_P0_IMAGE,disposable:true,schemaMode:variant.startsWith('two-schema')});
 const baseline=backend.php('state');assertNoOrders(baseline);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  assert.equal(browser.version(),'156.0.8078.80');const orders=[],evidence={};
  const provider=new Provider({browser,backend,baseURL:process.env.PLAYWRIGHT_BASE_URL,contextOptions:{ignoreHTTPSErrors:true},state:async()=>backend.php('state'),measureActions:true});
  const fixture=JSON.parse(fs.readFileSync(path.join(workspace,'.runtime/checkout-fixture.json')));
  const full=workflow(backend,fixture,orders,evidence);
  const graph=selected.length?new Graph({identity:full.identity,stages:[...full.stages.values()],specs:full.select(selected)}):full;
  if(variant==='two-schema-prefetch'){
   provider.configurePlan(graph.select());
   for(const spec of graph.specs.values()){
    const run=spec.run,check=spec.assert;
    spec.run=async(...args)=>{try{return await run(...args);}catch(error){provider.completeSpec();throw error;}};
    spec.assert=async(...args)=>{try{return await check(...args);}finally{provider.completeSpec();}};
   }
  }
  const report=await execute({workflow:graph,provider,root,approach:'P0',checkpointLifetime:'last-consumer'});
  const result={variant:'two-schema-live-server',experimentSources:Object.fromEntries(['backend.cjs','transactions.cjs','prefetch.cjs','live-server.cjs','live-run.cjs','fcgi.php','schema-probe.php','drain-probe.php'].map(f=>[f,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname,f))).digest('hex')])),report,orders,evidence,operations:backend.operations,events:backend.events,
   cleanup:{lockReleased:!fs.existsSync(path.join(workspace,'.runtime/workflow.lock')),recoveryReleased:!fs.existsSync(path.join(workspace,'.runtime/branching-recovery.json')),runStorageReleased:!fs.existsSync(report.directory),baselineEqual:false}};
  if(result.cleanup.lockReleased&&result.cleanup.recoveryReleased)try{result.cleanup.baselineEqual=JSON.stringify(backend.php('state'))===JSON.stringify(baseline);}catch(error){result.cleanupError=error.message;}
  const output=path.join(workspace,'.runtime/restart-results');fs.mkdirSync(output,{recursive:true});const file=path.join(output,report.run+'.json');fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600});hostOwner(output);hostOwner(file);
  console.log(JSON.stringify({file,variant:result.variant,status:report.status,counts:report.counts,metrics:report.metrics,cleanup:result.cleanup,errors:report.errors},null,2));
  assert.equal(report.status,'passed');assert.ok(Object.values(result.cleanup).every(Boolean));assert.equal(report.counts.fallbacks,0);
  assert.equal(orders.length,selected.length||9);
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
