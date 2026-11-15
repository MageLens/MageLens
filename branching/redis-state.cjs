// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {settings} = require('./configs/magento.cjs');
const maxBytes = 64 * 1024 * 1024;
const capture = `
local function hex(s) return (s:gsub('.', function(c) return string.format('%02x', string.byte(c)) end)) end
local time = redis.call('TIME'); local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
local rows = {}
for db=0,tonumber(ARGV[1])-1 do
 redis.call('SELECT', db)
 local keys = redis.call('KEYS', '*'); table.sort(keys)
 for _,key in ipairs(keys) do
  local value = redis.call('DUMP', key); local ttl = redis.call('PTTL', key)
  if value and ttl ~= -2 then table.insert(rows, {db,hex(key),hex(value),ttl < 0 and 0 or now+ttl}) end
 end
end
return cjson.encode({version=1,records=rows})`;
const restore = `
local function bytes(s) return (s:gsub('..', function(c) return string.char(tonumber(c,16)) end)) end
local snapshot = cjson.decode(ARGV[1])
local time = redis.call('TIME'); local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
redis.call('FLUSHALL')
for _,row in ipairs(snapshot.records) do
 if row[4] == 0 or row[4] > now then
  redis.call('SELECT',row[1]); redis.call('RESTORE',bytes(row[2]),row[4],bytes(row[3]),'REPLACE','ABSTTL')
 end
end
return 'OK'`;
function validate(snapshot, databases) {
    assert.equal(snapshot.version, 1, 'Unsupported Redis checkpoint');
    // Redis cjson encodes an empty Lua table as an empty object.
    if (snapshot.records && !Array.isArray(snapshot.records) && !Object.keys(snapshot.records).length) snapshot.records = [];
    assert.ok(Array.isArray(snapshot.records), 'Invalid Redis checkpoint records');
    const keys = new Set();
    for (const row of snapshot.records) {
        assert.ok(Array.isArray(row) && row.length === 4 && Number.isInteger(row[0]) && row[0] >= 0 && row[0] < databases &&
            typeof row[1] === 'string' && /^(?:[a-f0-9]{2})*$/.test(row[1]) && typeof row[2] === 'string' && /^(?:[a-f0-9]{2})+$/.test(row[2]) &&
            Number.isSafeInteger(row[3]) && row[3] >= 0, 'Invalid Redis checkpoint record');
        const key = `${row[0]}:${row[1]}`; assert.ok(!keys.has(key), 'Duplicate Redis checkpoint key'); keys.add(key);
    }
    return snapshot;
}
class RedisState {
    constructor(backend) { this.backend = backend; }
    command(args, input) {
        try {
            return execFileSync('bash', ['-c', settings.composeCommand, 'branching-cache', this.backend.workspace,
                'exec','-T','redis','redis-cli','--raw',...args], {input,encoding:'utf8',maxBuffer:maxBytes,timeout:settings.commandTimeoutMs}).trim();
        } catch (error) {
            // eslint-disable-next-line preserve-caught-error -- Child-process diagnostics may contain private cache bytes.
            throw new Error('Redis checkpoint operation failed (status ' + String(error.status ?? error.code) + ')');
        }
    }
    count() {
        const count = Number(this.command(['CONFIG','GET','databases']).split('\n').at(-1));
        assert.ok(Number.isInteger(count) && count > 0 && count <= 128, 'Unsupported Redis database count');
        return count;
    }
    save(file) {
        const snapshot = validate(JSON.parse(this.command(['EVAL',capture,'0',String(this.count())])), this.count());
        fs.writeFileSync(file,JSON.stringify(snapshot),{mode:0o600});
    }
    restore(file) {
        const stat = fs.lstatSync(file);
        assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes, 'Invalid Redis checkpoint file');
        const snapshot = validate(JSON.parse(fs.readFileSync(file)),this.count());
        assert.equal(this.command(['-x','EVAL',restore,'0'],JSON.stringify(snapshot)), 'OK', 'Redis checkpoint restore failed');
    }
}
module.exports = {RedisState, validate};
