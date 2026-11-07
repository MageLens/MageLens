// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../../..');
const {foreignTransactions}=require('./transactions.cjs');
const {CheckoutBackend}=require(root+'/tests/branching-checkout.cjs');
const {MagentoBackend}=require(root+'/branching/magento.cjs');
const {P0Provider}=require(root+'/branching/provider.cjs');
const {clone,regularTree}=require(root+'/branching/storage.cjs');
function replaceContents(source,destination,ownerRoot){
 const owner=fs.realpathSync(ownerRoot);assert.ok(fs.realpathSync(destination).startsWith(owner+path.sep));
 regularTree(source);regularTree(destination);
 for(const name of fs.readdirSync(destination))fs.rmSync(path.join(destination,name),{recursive:true});
 for(const name of fs.readdirSync(source))clone(path.join(source,name),path.join(destination,name));
}
class WarmBackend extends CheckoutBackend {
 constructor(options){super(options);this.schemaMode=options.schemaMode;this.events=[];this.warmReady=false;this.ingressPaused=false;this.activeSchema='magento';this.operations=[];this.identity={...this.identity,experiment:require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),schemaMode:this.schemaMode};}
 dc(args,original=false){const start=performance.now();try{return super.dc(args,original);}finally{this.operations.push({command:args,ms:performance.now()-start});}}
 sql(query){return this.dc(['exec','-T','db','sh','-c','exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names "$1" --execute "$2"','p0-sql',this.activeSchema,query]);}
 dbCommand(command,options={}){
  const start=performance.now();try{return execFileSync('bash',['-c','source "$1/bin/common"; shift; export LOCAL_UID="${MAGELENS_HOST_UID:-$LOCAL_UID}" LOCAL_GID="${MAGELENS_HOST_GID:-$LOCAL_GID}"; dc "$@"','p0-experiment',this.workspace,'-f',this.override,...command],{cwd:this.workspace,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024,...options});}
  finally{this.operations.push({command,ms:performance.now()-start});}
 }
 dump(file){const fd=fs.openSync(file,'w',0o600);try{this.dbCommand(['exec','-T','db','sh','-c','exec mariadb-dump -uroot --password="$MYSQL_ROOT_PASSWORD" --single-transaction --skip-lock-tables --routines --triggers "$1"','dump',this.activeSchema],{stdio:['ignore',fd,'pipe']});}finally{fs.closeSync(fd);}}
 fcgi(status=false){return JSON.parse(this.dc(['exec','-T','phpfpm','php','/p0-control/fcgi.php',status?'/sock/p0-status.sock':'/sock/phpfpm.sock',status?'/p0-status':'/p0-control/schema-probe.php',status?'/p0-status':'/p0-schema-probe.php',status?'json&full':'']));}
 async idle(){const deadline=Date.now()+30000;let busyObserved=false;while(true){const state=this.fcgi(true);if(state['active processes']===0&&state['listen queue']===0){this.events.push({event:'idle',active:0,queue:0,busyObserved,workers:state.processes?.map(p=>p.pid)});return state;}busyObserved=true;if(Date.now()>deadline)throw new Error('PHP workers did not become idle: '+JSON.stringify(state));await delay(50);}}
 async prepare(info){
  const fpm=this.dc(['exec','-T','phpfpm','cat','/usr/local/etc/php-fpm.conf']);
  await super.prepare(info);
  this.control=path.join(info.directory,'control');fs.mkdirSync(this.control);
  for(const file of ['fcgi.php','schema-probe.php','drain-probe.php'])fs.copyFileSync(path.join(__dirname,file),path.join(this.control,file));
  fs.writeFileSync(path.join(this.control,'php-fpm.conf'),fpm+'\npm.status_path = /p0-status\npm.status_listen = /sock/p0-status.sock\npm.max_requests = 0\n');
  const override=JSON.parse(fs.readFileSync(this.override));
  const mount=(source,target)=>({type:'bind',source,target,read_only:true,bind:{create_host_path:false}});
  override.services.phpfpm.volumes.push(mount(this.control,'/p0-control'),mount(path.join(this.control,'php-fpm.conf'),'/usr/local/etc/php-fpm.conf'));
  if(this.schemaMode){
   this.schemas=['a','b'].map(s=>'ml_'+info.run.replaceAll('-','').slice(0,16)+'_'+s);
   this.dataDirectory=this.paths.database;this.paths.database=path.join(info.directory,'active','sql');fs.mkdirSync(this.paths.database);
   fs.copyFileSync(path.join(this.workspace,'src/app/etc/env.php'),path.join(this.control,'original-env.php'));
   fs.chownSync(path.join(this.control,'original-env.php'),Number(process.env.MAGELENS_HOST_UID),Number(process.env.MAGELENS_HOST_GID));
   fs.chmodSync(path.join(this.control,'original-env.php'),0o600);
   this.switchSchema('magento');
   fs.writeFileSync(path.join(this.control,'env.php'),`<?php\n$c=require '/p0-control/original-env.php';\nif(array_keys($c['db']['connection'])!==['default'])throw new RuntimeException('Additional database connections require qualification');\n$s=trim(file_get_contents('/p0-control/active-schema'));\nif(!preg_match('/^(magento|ml_[a-f0-9]{16}_[ab])$/D',$s))throw new RuntimeException('Invalid active schema');\n$c['db']['connection']['default']['dbname']=$s;\nreturn $c;\n`);
   override.services.phpfpm.volumes.push(mount(path.join(this.control,'env.php'),'/var/www/html/app/etc/env.php'));
  }
  fs.writeFileSync(this.override,JSON.stringify(override,null,2));
  if(this.schemaMode){
   await this.start();await this.drain();
   const inventory=this.sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA');
   for(const schema of this.schemas){assert.ok(!inventory.split('\n').includes(schema));this.sql('CREATE DATABASE `'+schema+'`; GRANT ALL ON `'+schema+'`.* TO \'magento\'@\'%\';');}
   this.dump(path.join(this.paths.database,'snapshot.sql'));
  }
 }
 switchSchema(schema){assert.ok(schema==='magento'||this.schemas.includes(schema));const file=path.join(this.control,'active-schema');fs.writeFileSync(file+'.pending',schema+'\n');fs.renameSync(file+'.pending',file);this.activeSchema=schema;this.events.push({event:'schema-switch',schema});}
 async drain(){
  if(!this.warmReady){await MagentoBackend.prototype.drain.call(this);if(this.inspect('db').State.Running)await this.drainQueues();return;}
  this.assertWriters();
  if(!this.ingressPaused){this.dc(['pause','app']);this.ingressPaused=true;}
  await this.idle();await this.drainQueues();
  const deadline=Date.now()+30000;
  while(true){
   const transactions=JSON.parse(this.sql("SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('schema',p.DB,'user',p.USER,'host',p.HOST)),JSON_ARRAY()) FROM information_schema.INNODB_TRX t LEFT JOIN information_schema.PROCESSLIST p ON p.ID=t.trx_mysql_thread_id"));
   const target=this.prefetchJob?.target;
   const foreign=foreignTransactions(transactions,{activeSchema:this.activeSchema,target,ownedSchemas:this.schemas});
   if(!foreign.length){if(transactions.length)this.events.push({event:'inactive-import-observed',schema:target,transactions:transactions.length});break;}
   if(Date.now()>deadline)throw new Error('Unfinished transactions outside the owned inactive import: '+JSON.stringify(foreign));
   await delay(50);
  }
  const phpHost=Object.values(this.inspect('phpfpm').NetworkSettings.Networks)[0].IPAddress;assert.match(phpHost,/^[0-9.]+$/);
  const connections=this.sql("SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='magento' AND HOST LIKE '"+phpHost+":%'");
  assert.equal(connections,'0','No application DB connection may cross the boundary');
 }
 async pause(){if(!this.schemaMode)return super.pause();this.dump(path.join(this.paths.database,'snapshot.sql'));}
 async unpause(){if(!this.schemaMode)return super.unpause();}
 async stop(){if(!this.schemaMode||!this.warmReady||this.recovering)return MagentoBackend.prototype.stop.call(this);this.needsImport=true;}
 async start(){
  const database=this.inspect('db').State;
  if(!database.Running)this.dc(['up','-d','--no-deps','--wait','--wait-timeout','180','db']);else{assert.ok(!database.Paused&&!database.OOMKilled);this.sql('SELECT 1');}
  if(this.schemaMode&&this.needsImport){
   const target=this.activeSchema===this.schemas[0]?this.schemas[1]:this.schemas[0];
   this.sql('DROP DATABASE `'+target+'`; CREATE DATABASE `'+target+'`;');
   const fd=fs.openSync(path.join(this.paths.database,'snapshot.sql'),'r');
   try{this.dbCommand(['exec','-T','db','sh','-c','exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" "$1"','restore',target],{stdio:[fd,'pipe','pipe']});}finally{fs.closeSync(fd);}
   this.switchSchema(target);this.needsImport=false;
  }
  if(!this.warmReady){this.dc(['up','-d','--no-deps','--wait','--wait-timeout','180','phpfpm','app']);this.warmReady=true;this.phpStartedAt=this.inspect('phpfpm').State.StartedAt;this.databaseStartedAt=this.inspect('db').State.StartedAt;}
  const proof=this.fcgi(false);assert.equal(proof.schema,this.activeSchema);assert.equal(proof.persistent,false);
  if(this.workerPid!==undefined)assert.equal(proof.pid,this.workerPid,'PHP worker must survive every branch');else this.workerPid=proof.pid;
  assert.equal(this.inspect('phpfpm').State.StartedAt,this.phpStartedAt,'PHP container restarted');
  if(this.schemaMode)assert.equal(this.inspect('db').State.StartedAt,this.databaseStartedAt,'Database restarted');
  this.events.push({event:'live-proof',...proof,phpStartedAt:this.phpStartedAt,databaseStartedAt:this.inspect('db').State.StartedAt});
  if(process.env.MAGELENS_RESTART_PROBE==='1'&&!this.selfTested){
   this.selfTested=true;
   const marker=path.join(this.paths.session,'p0-drain-probe');assert.ok(!fs.existsSync(marker));
   const before=performance.now();
   const result=JSON.parse(this.dc(['exec','-T','phpfpm','php','/p0-control/fcgi.php','/sock/phpfpm.sock','/p0-control/drain-probe.php','/p0-drain-probe.php','']));
   assert.equal(result.pid,this.workerPid);
   await this.drain();
   assert.equal(fs.readFileSync(marker,'utf8'),'finished');fs.rmSync(marker);
   assert.ok(this.events.filter(e=>e.event==='idle').at(-1).busyObserved,'Probe must observe background PHP still running');
   this.events.push({event:'post-response-drain-qualified',ms:performance.now()-before,workerPid:result.pid});
  }
  // Fresh SELECT 1 and a real FPM request prove readiness directly after unpause.
  this.awaitingResumedProbe=false;
  if(this.ingressPaused){this.dc(['unpause','app']);this.ingressPaused=false;}
 }
 async cleanup(){
  this.recovering=true;
  if(this.ingressPaused){this.dc(['unpause','app']);this.ingressPaused=false;}
  this.warmReady=false;
  await super.cleanup();
  this.activeSchema='magento';
 }
}
class WarmProvider extends P0Provider{
 async restore(directory){
  if(this.context)await this.browserState.freeze();
  await this.backend.drain();
  if(this.context)for(const page of this.context.pages())await page.close();
  await this.backend.stop();
  for(const [name,destination]of Object.entries(this.backend.paths))replaceContents(path.join(directory,name),destination,this.directory);
  await this.backend.resetCaches();await this.backend.start();
  await this.browserState.open(JSON.parse(fs.readFileSync(path.join(directory,'browser.json'))));
 }
}
module.exports={WarmBackend,WarmProvider,replaceContents};
