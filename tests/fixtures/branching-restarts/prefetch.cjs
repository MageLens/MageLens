// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {WarmBackend,WarmProvider,replaceContents}=require('./backend.cjs');
const {clone}=require(path.resolve(__dirname,'../../..')+'/branching/storage.cjs');
const {fileDigest}=require(path.resolve(__dirname,'../../..')+'/branching/engine.cjs');
class PrefetchBackend extends WarmBackend{
 constructor(options){super(options);this.identity={...this.identity,prefetch:fileDigest(__filename)};}
 prefetch(file){
  assert.ok(!this.prefetchJob,'Only one inactive schema may be prepared');
  const target=this.activeSchema===this.schemas[0]?this.schemas[1]:this.schemas[0];
  const job={target,key:fileDigest(file),started:performance.now()};this.prefetchJob=job;
  const fd=fs.openSync(file,'r');
  const ddl='DROP DATABASE `'+target+'`; CREATE DATABASE `'+target+'`;';
  const args=['-c','source "$1/bin/common"; shift; export LOCAL_UID="${MAGELENS_HOST_UID:-$LOCAL_UID}" LOCAL_GID="${MAGELENS_HOST_GID:-$LOCAL_GID}"; dc "$@"','p0-prefetch',this.workspace,'-f',this.override,'exec','-T','db','sh','-c','set -e; mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --execute "$2"; exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" "$1"','restore',target,ddl];
  const child=spawn('bash',args,{cwd:this.workspace,stdio:[fd,'pipe','pipe'],timeout:180000});fs.closeSync(fd);
  let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4000);});child.stdout.resume();
  job.promise=new Promise(resolve=>{child.on('error',error=>{job.error=error;});child.on('close',code=>{job.ms=performance.now()-job.started;if(code!==0)job.error??=new Error('Inactive-schema preparation failed: '+stderr);this.operations.push({command:['prefetch-schema',target],ms:job.ms});resolve();});});
  this.events.push({event:'prefetch-start',active:this.activeSchema,target,key:job.key});
 }
 async start(){
  if(this.needsImport&&this.prefetchJob){
   const job=this.prefetchJob;assert.notEqual(job.target,this.activeSchema);
   assert.equal(job.key,fileDigest(path.join(this.paths.database,'snapshot.sql')),'Prepared schema must match the requested checkpoint');
   const start=performance.now();await job.promise;if(job.error)throw job.error;
   this.events.push({event:'prefetch-consume',target:job.target,key:job.key,importMs:job.ms,waitMs:performance.now()-start});
   this.switchSchema(job.target);this.needsImport=false;this.prefetchJob=null;
  }
  return super.start();
 }
 async cleanup(){
  const job=this.prefetchJob;if(job)await job.promise;
  try{await super.cleanup();}finally{this.prefetchJob=null;}
  if(job?.error)throw job.error;
 }
}
class PrefetchProvider extends WarmProvider{
 beforeSpec({id,index}){assert.equal(this.plan[index].id,id);this.completed=index;}
 configurePlan(specs){this.plan=specs.map(s=>({id:s.id,parent:s.parent}));this.completed=0;this.sqlCache=new Map();}
 async prepare(info){await super.prepare(info);this.cacheDirectory=path.join(this.directory,'prefetch-sql');fs.mkdirSync(this.cacheDirectory);this.backend.prefetch(path.join(this.base,'database','snapshot.sql'));}
 async capture(directory){
  await super.capture(directory);
  const stage=this.plan[this.completed].parent;assert.ok(!this.sqlCache.has(stage));
  const cached=path.join(this.cacheDirectory,stage+'.sql');clone(path.join(directory,'database','snapshot.sql'),cached);this.sqlCache.set(stage,cached);
 }
 scheduleNext(){
  const current=this.plan[this.completed],next=this.plan[this.completed+1];if(!next)return;
  const source=next.parent===current.parent?this.sqlCache.get(next.parent):path.join(this.base,'database','snapshot.sql');
  if(source)this.backend.prefetch(source);
 }
 async resumeCapture(){await super.resumeCapture();this.scheduleNext();}
 async restore(directory){
  if(this.context)await this.browserState.freeze();await this.backend.drain();
  if(this.context)for(const page of this.context.pages())await page.close();
  await this.backend.stop();
  for(const [name,destination]of Object.entries(this.backend.paths))replaceContents(path.join(directory,name),destination,this.directory);
  await this.backend.resetCaches();await this.backend.start();this.scheduleNext();
  await this.browserState.open(JSON.parse(fs.readFileSync(path.join(directory,'browser.json'))));
 }
 completeSpec(){
  const current=this.plan[this.completed];this.completed++;
  if(this.plan[this.completed]?.parent!==current.parent){
   const file=this.sqlCache.get(current.parent);if(file){fs.rmSync(file);this.sqlCache.delete(current.parent);this.backend.events.push({event:'prefetch-cache-release',stage:current.parent,after:current.id});}
  }
 }
}
module.exports={PrefetchBackend,PrefetchProvider};
