// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {BranchingProvider} = require('../branching/provider.cjs');
const {regularTree, replace} = require('../branching/storage.cjs');
const {MagentoBackend, checkpointNginx, resumedHealth} = require('../branching/magento.cjs');

test('a failure after engaging the database freezer still unpauses it', async () => {
    const calls = [];
    const backend = {identity: {kind: 'failure-fixture'}};
    for (const name of ['prepare', 'drain', 'stop', 'start', 'resetCaches', 'cleanup']) backend[name] = async () => {};
    backend.pause = async () => { calls.push('paused'); throw new Error('sync failed after pause'); };
    backend.unpause = async () => { calls.push('unpaused'); };
    const provider = new BranchingProvider({browser: {version: () => 'test'}, backend, state: async () => ({}), baseURL: 'https://example.test'});
    await assert.rejects(provider.capture('/unused'), /sync failed/);
    assert.deepEqual(calls, ['paused', 'unpaused']); assert.equal(provider.paused, false);
});
test('state replacement refuses symlinks and paths outside the owned run', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'branching-safety-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const run = path.join(directory, 'run'), outside = path.join(directory, 'outside');
    fs.mkdirSync(run); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep'), 'original');
    fs.symlinkSync(outside, path.join(run, 'linked'));
    assert.throws(() => regularTree(run), /Unsupported state file/);
    assert.throws(() => replace(outside, outside, run), /unowned/);
    assert.throws(() => replace(outside, path.join(run, 'linked'), run), /unowned/);
    assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'original');
});
test('snapshot-and-continue starts only application services while checking the retained DB', async () => {
    const backend = Object.create(MagentoBackend.prototype), calls = [];
    backend.inspect = () => ({State: {Running: true, Paused: false, OOMKilled: false, Health: {Status: 'healthy'}}});
    backend.sql = query => { calls.push(query); return '1'; };
    backend.dc = args => calls.push(args);
    await backend.start();
    assert.equal(calls[0], 'SELECT 1');
    assert.deepEqual(calls[1].slice(-2), ['phpfpm', 'app']);
    assert.ok(!calls[1].includes('db'));
    backend.inspect = () => ({State: {Running: true, Paused: false, Health: {Status: 'unhealthy'}}});
    await assert.rejects(backend.start(), /not healthy/);
});
test('database state and IDs never rewind the external branch allocator', () => {
    const provider = Object.create(BranchingProvider.prototype); provider.run = 'run-id'; provider.serial = 0;
    const first = provider.allocateId('order'); provider.saved = {serial: 0};
    const second = provider.allocateId('order');
    assert.notEqual(first, second); assert.match(first, /^order-run-id-1-/); assert.match(second, /^order-run-id-2-/);
    assert.throws(() => provider.allocateId('../invalid'), /Invalid/);
});
test('nginx boundary limits only connections which have not submitted a request', () => {
    const source = 'events {}\nhttp {\n fastcgi_read_timeout 600s;\n keepalive_timeout 65s;\n}\n';
    const result = checkpointNginx(source);
    assert.match(result, /client_header_timeout 5s;/);
    assert.match(result, /fastcgi_read_timeout 600s;/); assert.match(result, /keepalive_timeout 65s;/);
    assert.doesNotMatch(result, /worker_shutdown_timeout/);
    assert.throws(() => checkpointNginx('events {}'), /Expected/);
    assert.throws(() => checkpointNginx(result), /Custom nginx/);
});
test('unpause waits for a fresh health probe without hiding new failures', async () => {
    const state = (status, end, exit = 0) => ({State: {Running: true, Paused: false, OOMKilled: false,
        Health: {Status: status, Log: [{End: end, ExitCode: exit}]}}});
    const sequence = [state('unhealthy', 'before-pause'), state('healthy', 'after-unpause')];
    await resumedHealth(() => sequence.shift(), 'before-pause');
    assert.equal(sequence.length, 0);
    await assert.rejects(resumedHealth(() => state('unhealthy', 'failed-new-probe', 1), 'before-pause'), /probe failed/);
    await assert.rejects(resumedHealth(() => state('healthy', 'before-pause'), 'before-pause', 0), /Timed out/);
    await assert.rejects(resumedHealth(() => ({State: {Running: true, OOMKilled: true}}), 'before-pause'), /not running safely/);
});


test('backend Compose overrides use private state and restore the original network identity', () => {
    const {composeOverride, settings, phpConfiguration} = require('../branching/configs/magento.cjs');
    const configuration = composeOverride({paths: {database: '/owned/db', media: '/owned/media', session: '/owned/session'},
        workspace: '/shop', cache: '/owned/cache', ini: '/owned/php.ini', nginxFile: '/owned/nginx.conf',
        networkName: 'shop_default', endpoint: {IPAddress: '172.20.0.5'}});
    assert.equal(configuration.networks.default.name, 'shop_default');
    assert.equal(configuration.services.app.networks.default.ipv4_address, '172.20.0.5');
    const database = configuration.services.db.volumes[0];
    assert.equal(database.source, '/owned/db');
    assert.equal(database.target, settings.database);
    assert.equal(database.bind.create_host_path, false);
    const media = configuration.services.app.volumes.find(mount => mount.source === '/owned/media');
    assert.equal(media.read_only, true);
    const cache = configuration.services.phpfpm.volumes.find(mount => mount.source === '/owned/cache');
    assert.ok(phpConfiguration.includes('opcache.file_cache=' + cache.target));
    for (const service of ['app', 'phpfpm']) {
        for (const mount of configuration.services[service].volumes.filter(mount => mount.source.startsWith('/shop/'))) {
            assert.equal(mount.read_only, true);
            assert.equal(mount.bind.create_host_path, false);
        }
    }
});
