// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {PrefetchBackend,PrefetchProvider}=require('./prefetch.cjs');
const {MagentoBackend,checkpointNginx}=require(path.resolve(__dirname,'../../..')+'/branching/magento.cjs');
const {fileDigest}=require(path.resolve(__dirname,'../../..')+'/branching/engine.cjs');
const {regularTree}=require(path.resolve(__dirname,'../../..')+'/branching/storage.cjs');
class LiveServerBackend extends PrefetchBackend{
 constructor(options){super(options);this.identity={...this.identity,liveServer:fileDigest(__filename)};this.ownedSchemas=[];}
 controlSql(query){return this.dc(['exec','-T','db','sh','-c','exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --execute "$1"','schema-control',query]);}
 grantIdentity(){return this.controlSql("SELECT * FROM mysql.db WHERE User='magento' ORDER BY Host,Db,User");}
 async prepare({run,directory}){
  this.run=run;this.directory=directory;
  const profile=fs.readFileSync(path.join(this.workspace,'.runtime/install-profile'),'utf8').trim().split(/\s+/);assert.equal(profile[1],'playwright');
  this.recovery=path.join(this.workspace,'.runtime/branching-recovery.json');assert.ok(!fs.existsSync(this.recovery));
  this.lock=path.join(this.workspace,'.runtime/workflow.lock');fs.mkdirSync(this.lock);this.ownsLock=true;
  fs.writeFileSync(path.join(this.lock,'branching.json'),JSON.stringify({run,directory}),{mode:0o600});
  assert.ok(this.dc(['config','--services']).split('\n').every(s=>['app','phpfpm','db','redis','opensearch','runner','workspace'].includes(s)));
  this.original=Object.fromEntries(['app','phpfpm','db','redis','opensearch','runner'].map(s=>[s,this.inspect(s)]));
  for(const c of Object.values(this.original))assert.ok(c.State.Running&&!c.State.Paused&&!c.State.OOMKilled);
  this.originalDatabaseStartedAt=this.original.db.State.StartedAt;
  this.assertWriters();
  this.dc(['exec','-T','phpfpm','php','-r', '$e=require "app/etc/env.php"; if(($e["db"]["connection"]["default"]["host"]??null)!=="db"||($e["db"]["connection"]["default"]["dbname"]??null)!=="magento"||($e["session"]["save"]??"files")!=="files")exit(1);foreach(($e["cache"]["frontend"]??[])as$v){$s=$v["backend_options"]["server"]??null;if($s!==null&&$s!=="redis")exit(2);}']);
  const fpm=this.dc(['exec','-T','phpfpm','cat','/usr/local/etc/php-fpm.conf']);
  const nginx=checkpointNginx(this.dc(['exec','-T','app','cat','/etc/nginx/nginx.conf']));
  this.originalGrants=this.grantIdentity();
  this.schemas=['a','b'].map(s=>'ml_'+run.replaceAll('-','').slice(0,16)+'_'+s);
  this.control=path.join(directory,'control');fs.mkdirSync(this.control);
  fs.writeFileSync(path.join(this.control,'original-grants.txt'),this.originalGrants,{mode:0o600});
  for(const file of ['fcgi.php','schema-probe.php','drain-probe.php'])fs.copyFileSync(path.join(__dirname,file),path.join(this.control,file));
  fs.writeFileSync(path.join(this.control,'php-fpm.conf'),fpm+'\npm.status_path = /p0-status\npm.status_listen = /sock/p0-status.sock\npm.max_requests = 0\n');
  fs.writeFileSync(path.join(this.control,'nginx.conf'),nginx);
  execFileSync('docker',['run','--rm','--network','none','--memory','256m','--volumes-from',this.original.app.Id+':ro','--mount','type=bind,source='+path.join(this.control,'nginx.conf')+',target=/etc/nginx/nginx.conf,readonly','--entrypoint','nginx',this.original.app.Image,'-t'],{stdio:'pipe'});
  fs.copyFileSync(path.join(this.workspace,'src/app/etc/env.php'),path.join(this.control,'original-env.php'));fs.chmodSync(path.join(this.control,'original-env.php'),0o600);
  fs.chownSync(path.join(this.control,'original-env.php'),Number(process.env.MAGELENS_HOST_UID),Number(process.env.MAGELENS_HOST_GID));
  this.switchSchema('magento');
  fs.writeFileSync(path.join(this.control,'env.php'),`<?php\n$c=require '/p0-control/original-env.php';\nif(array_keys($c['db']['connection'])!==['default'])throw new RuntimeException('Additional database connections require qualification');\n$s=trim(file_get_contents('/p0-control/active-schema'));\nif(!preg_match('/^(magento|ml_[a-f0-9]{16}_[ab])$/D',$s))throw new RuntimeException('Invalid active schema');\n$c['db']['connection']['default']['dbname']=$s;\nreturn $c;\n`);
  const active=path.join(directory,'active');fs.mkdirSync(active);
  this.paths={database:path.join(active,'sql'),media:path.join(active,'media'),session:path.join(active,'session')};fs.mkdirSync(this.paths.database);
  const cache=path.join(directory,'php-code-cache');fs.mkdirSync(cache);fs.chmodSync(cache,0o777);
  fs.writeFileSync(path.join(this.control,'p0.ini'),'pcov.enabled=0\nblackfire.apm_enabled=0\nblackfire.apm_enable_automatic_browser_probe=0\nspx.http_enabled=0\nopcache.enable=1\nopcache.file_cache=/p0-code-cache\nopcache.file_cache_consistency_checks=1\nopcache.validate_timestamps=1\nopcache.revalidate_freq=0\n');
  this.override=path.join(directory,'compose.p0.json');
  const mount=(source,target,readOnly=false)=>({type:'bind',source,target,read_only:readOnly,bind:{create_host_path:false}});
  const code=['app/code','app/design/frontend','app/design/adminhtml'].map(relative=>mount(path.join(this.workspace,'src',relative),'/var/www/html/'+relative,true));
  const network=Object.entries(this.original.app.NetworkSettings.Networks);assert.equal(network.length,1);const [networkName,endpoint]=network[0];
  fs.writeFileSync(this.override,JSON.stringify({services:{
   phpfpm:{stop_signal:'SIGQUIT',stop_grace_period:'60s',volumes:[mount(this.paths.media,'/var/www/html/pub/media'),mount(this.paths.session,'/var/www/html/var/session'),mount(cache,'/p0-code-cache'),mount(this.control,'/p0-control',true),mount(path.join(this.control,'env.php'),'/var/www/html/app/etc/env.php',true),mount(path.join(this.control,'php-fpm.conf'),'/usr/local/etc/php-fpm.conf',true),mount(path.join(this.control,'p0.ini'),'/usr/local/etc/php/conf.d/zzzz-p0.ini',true),...code]},
   app:{stop_signal:'SIGQUIT',stop_grace_period:'60s',volumes:[mount(this.paths.media,'/var/www/html/pub/media',true),mount(path.join(this.control,'nginx.conf'),'/etc/nginx/nginx.conf',true),...code],networks:{default:{ipv4_address:endpoint.IPAddress}}}
  },networks:{default:{external:true,name:networkName}}},null,2));
  fs.writeFileSync(this.recovery,JSON.stringify({run,directory,override:this.override,project:this.original.db.Config.Labels['com.docker.compose.project'],kind:'two-schema-live-server',schemas:this.schemas,grantsBefore:path.join(this.control,'original-grants.txt')}),{flag:'wx',mode:0o600});this.changed=true;
  // Fencing changes only nginx/PHP; the original database server stays alive.
  const privateOverride=this.override;this.override=null;
  try{await this.drain();}finally{this.override=privateOverride;}
  for(const [relative,name]of [['pub/media','media'],['var/session','session']]){regularTree(path.join(this.workspace,'src',relative));execFileSync('cp',['-a','--reflink=auto','--',path.join(this.workspace,'src',relative),this.paths[name]]);}
  const inventory=this.controlSql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA').split('\n');
  for(const schema of this.schemas){assert.ok(!inventory.includes(schema));this.controlSql('CREATE DATABASE `'+schema+'`;');this.ownedSchemas.push(schema);this.controlSql('GRANT ALL ON `'+schema.replaceAll('_','\\_')+'`.* TO \'magento\'@\'%\';');}
  this.dump(path.join(this.paths.database,'snapshot.sql'));
  await this.start();await this.drain();
 }
 async cleanup(){
  if(!this.ownsLock)return;
  const job=this.prefetchJob;if(job)await job.promise;
  this.recovering=true;
  if(this.ingressPaused){this.dc(['unpause','app']);this.ingressPaused=false;}
  this.warmReady=false;
  if(this.changed){
   await MagentoBackend.prototype.drain.call(this);
   this.dc(['up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','180','phpfpm','app'],true);
   this.activeSchema='magento';
   for(const schema of this.ownedSchemas){
    this.controlSql('REVOKE ALL PRIVILEGES ON `'+schema.replaceAll('_','\\_')+'`.* FROM \'magento\'@\'%\'; DROP DATABASE `'+schema+'`;');
   }
   assert.equal(this.grantIdentity(),this.originalGrants,'Temporary database grants must be removed exactly');
   const inventory=this.controlSql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA').split('\n');assert.ok(this.ownedSchemas.every(s=>!inventory.includes(s)));
   assert.equal(this.inspect('db').State.StartedAt,this.originalDatabaseStartedAt,'Database must survive preparation and cleanup too');
   for(const service of ['app','phpfpm','db'])assert.ok(!this.inspect(service).Mounts.some(m=>m.Source.startsWith(this.directory+path.sep)));
   this.events.push({event:'live-server-cleanup',databaseStartedAt:this.originalDatabaseStartedAt,schemasRemoved:true,grantsRestored:true});
  }
  if(fs.existsSync(this.recovery))fs.rmSync(this.recovery);
  fs.rmSync(path.join(this.lock,'branching.json'));fs.rmdirSync(this.lock);this.ownsLock=false;this.prefetchJob=null;
  if(job?.error)throw job.error;
 }
}
module.exports={LiveServerBackend,PrefetchProvider};
