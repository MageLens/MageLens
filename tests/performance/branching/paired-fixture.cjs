// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Benchmark-only fixture boundary. Never use against a shared installation.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {SchemaDatabase} = require('../../../branching/retained-database.cjs');
const {RedisState} = require('../../../branching/redis-state.cjs');
const {regularTree} = require('../../../branching/storage.cjs');
async function fixture(workspace, storage, project, coverageCommand) {
    assert.match(project ?? '', /^magelens-[a-z0-9-]+$/);
    assert.equal(fs.readFileSync(path.join(workspace,'.runtime/install-profile'),'utf8').trim(), 'luma playwright mageos');
    const compose = path.join(workspace,'bin/application-compose');
    const ids = execFileSync(compose,['ps','-q','db','app','phpfpm','redis'],{encoding:'utf8'}).trim().split(/\s+/);
    assert.equal(ids.length,4);
    const containers = JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'}));
    for (const container of containers) assert.equal(container.Config.Labels['com.docker.compose.project'],project);
    const networks = [...new Set(containers.flatMap(container=>Object.keys(container.NetworkSettings.Networks)))];
    assert.equal(networks.length,1);
    const network = JSON.parse(execFileSync('docker',['network','inspect',networks[0]],{encoding:'utf8'}))[0];
    assert.equal(network.Internal,true); assert.equal(network.Labels['com.docker.compose.project'],project);
    const connection = JSON.parse(execFileSync(compose,['exec','-T','phpfpm','php','-r',
        '$e=require "/var/www/html/app/etc/env.php"; $d=$e["db"]["connection"]["default"]; echo json_encode([$d["host"],$d["dbname"]]);'],{encoding:'utf8'}));
    assert.deepEqual(connection,['db','magento']);
    const recovery = path.join(workspace,'.runtime/branching-recovery.json');
    assert.equal(fs.existsSync(recovery),false);
    const directory = fs.mkdtempSync(path.join(storage,'paired-fixture-'));
    const backend = {workspace,activeSchema:'magento'};
    const database = new SchemaDatabase(backend), redis = new RedisState(backend);
    const targets = ['pub/media','var/session'].map(relative=>path.join(workspace,'src',relative));
    const stop = () => coverageCommand(['dc','stop','-t','60','app','phpfpm']);
    const start = () => coverageCommand(['dc','up','-d','--no-deps','--wait','--wait-timeout','120','phpfpm','app']);
    stop();
    try {
        database.dump(path.join(directory,'database.sql')); redis.save(path.join(directory,'redis.json'));
        for (const [index,target] of targets.entries()) {
            regularTree(target); assert.ok(fs.realpathSync(target).startsWith(workspace+path.sep));
            execFileSync('cp',['-a','--reflink=auto','--',target,path.join(directory,String(index))]);
        }
    } finally { start(); }
    return {
        directory,
        reset() {
            fs.writeFileSync(recovery,JSON.stringify({kind:'paired-fixture',directory,project}),{flag:'wx',mode:0o600});
            stop();
            const fd = fs.openSync(path.join(directory,'database.sql'),'r');
            try {
                database.command(['exec','-T','db','sh','-c','exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" magento'],{stdio:[fd,'ignore','pipe']});
                for (const [index,target] of targets.entries()) {
                    regularTree(target);
                    for (const name of fs.readdirSync(target)) fs.rmSync(path.join(target,name),{recursive:true});
                    execFileSync('cp',['-a','--reflink=auto','--',path.join(directory,String(index))+ '/.',target]);
                }
                redis.restore(path.join(directory,'redis.json'));
            } finally { fs.closeSync(fd); start(); }
            fs.unlinkSync(recovery);
        },
        remove() { assert.equal(fs.existsSync(recovery),false); fs.rmSync(directory,{recursive:true}); }
    };
}
module.exports = {fixture};
