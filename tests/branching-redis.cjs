// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');
const {RedisState} = require('../branching/redis-state.cjs');
async function checkRedisState(image = 'valkey/valkey:8.1-alpine') {
    const name = 'magelens-cache-check-' + randomUUID();
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cache-check-'));
    const docker = args => execFileSync('docker', args, {encoding:'utf8',timeout:60000}).trim();
    let created = false;
    try {
        docker(['run','-d','--name',name,'--network','none','--memory','128m','--memory-swap','128m',image]); created = true;
        fs.mkdirSync(path.join(workspace,'bin'));
        fs.writeFileSync(path.join(workspace,'bin/common'), `dc() { [[ $1 == exec && $2 == -T && $3 == redis ]] || return 1; shift 3; docker exec -i ${name} "$@"; }\n`);
        const state = new RedisState({workspace});
        for (let i=0; i<50; i++) {
            if (docker(['exec',name,'redis-cli','PING']) === 'PONG') break;
            await delay(100);
        }
        state.command(['EVAL',"redis.call('SET','binary',string.char(0,10,255)); redis.call('SET','ttl','value','PX',60000); redis.call('SET','expired','value','PX',5000); redis.call('SELECT',15); redis.call('HSET','hash','field','original'); return 'OK'",'0']);
        const file = path.join(workspace,'snapshot.json'); state.save(file);
        const saved = JSON.parse(fs.readFileSync(file)); assert.equal(saved.records.length,4);
        state.command(['FLUSHALL']); state.command(['SET','discarded','new']);
        const expires = saved.records.find(row=>row[1]===Buffer.from('expired').toString('hex'))[3];
        await delay(Math.max(0,expires-Date.now()+50)); state.restore(file);
        assert.equal(state.command(['EVAL',"return string.byte(redis.call('GET','binary'),3)",'0']), '255');
        assert.equal(state.command(['GET','discarded']), '');
        assert.equal(state.command(['EXISTS','expired']), '0');
        const remaining = Number(state.command(['PTTL','ttl']));
        assert.ok(remaining > 0 && remaining < 59500, 'Restoration changed the expiration deadline');
        assert.equal(state.command(['-n','15','HGET','hash','field']), 'original');
        const invalid = {...saved,records:[[0,'bad-hex','00',0]]}; fs.writeFileSync(file,JSON.stringify(invalid));
        assert.throws(() => state.restore(file), /Invalid Redis checkpoint record/);
        assert.equal(state.command(['-n','15','HGET','hash','field']), 'original', 'Invalid checkpoint mutated Redis');
        fs.writeFileSync(file,JSON.stringify({...saved,records:[[0,'61','00',0]]}));
        assert.throws(() => state.restore(file), /Redis checkpoint restore failed/);
        fs.writeFileSync(file,JSON.stringify(saved)); state.restore(file);
        assert.equal(state.command(['-n','15','HGET','hash','field']), 'original');
        state.command(['FLUSHALL']); state.save(file); state.restore(file);
        assert.equal(state.command(['DBSIZE']), '0');
        return {binary:true,multipleDatabases:true,expirationPreserved:true,failedRestoreRejected:true,emptySnapshot:true};
    } finally {
        if (created) docker(['rm','-f',name]);
        fs.rmSync(workspace,{recursive:true,force:true});
    }
}
if (require.main === module) checkRedisState(process.argv[2]).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
module.exports = {checkRedisState};
