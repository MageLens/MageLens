// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const {LinearCheckout} = require('../branching/linear-checkout.cjs');
const {fileDigest} = require('../../../branching/engine.cjs');

// Ordinary SQL + tar control. This module deliberately imports no P0 provider,
// reflink storage, browser restoration, asset cache or schema-switching code.
class WarmLinear extends LinearCheckout {
    constructor(options) {
        super(options);
        this.identity = {...this.identity, warmPhpControl: fileDigest(__filename)};
        this.warmReady = false; this.ingressPaused = false; this.events = [];
    }
    container(service) {
        const id = super.dc(['ps', '-a', '-q', service]);
        return JSON.parse(execFileSync('docker', ['inspect', id], {encoding: 'utf8'}))[0];
    }
    status() {
        return JSON.parse(this.dc(['exec', '-T', 'phpfpm', 'php', '/linear-control/fcgi.php',
            '/sock/p0-status.sock', '/p0-status', '/p0-status', 'json&full']));
    }
    continuity() {
        const state = this.container('phpfpm').State, status = this.status();
        const workers = status.processes.map(p => p.pid).sort();
        if (this.phpStartedAt) {
            assert.equal(state.StartedAt, this.phpStartedAt, 'Linear PHP must remain running');
            assert.deepEqual(workers, this.workerPids, 'Linear PHP workers must remain running');
        } else { this.phpStartedAt = state.StartedAt; this.workerPids = workers; }
        this.events.push({event: 'retained-linear-php', startedAt: state.StartedAt, workers});
    }
    dc(args, options = {}) {
        const startPhp = args[0] === 'up' && args.includes('phpfpm') && args.includes('app');
        if (startPhp && this.warmReady) {
            this.continuity();
            if (this.ingressPaused) {
                super.dc(['-f', this.override, 'unpause', 'app']);
                this.ingressPaused = false;
            }
            return '';
        }
        const result = super.dc(this.override ? ['-f', this.override, ...args] : args, options);
        if (startPhp && this.override) { this.warmReady = true; this.continuity(); }
        return result;
    }
    async prepare(info) {
        this.originalDatabaseStartedAt = this.container('db').State.StartedAt;
        const configuration = this.dc(['exec', '-T', 'phpfpm', 'cat', '/usr/local/etc/php-fpm.conf']);
        await super.prepare(info);
        this.control = path.join(info.directory, 'linear-control'); fs.mkdirSync(this.control);
        fs.copyFileSync(path.join(__dirname, 'fcgi.php'), path.join(this.control, 'fcgi.php'));
        fs.writeFileSync(path.join(this.control, 'php-fpm.conf'), configuration +
            '\npm.status_path = /p0-status\npm.status_listen = /sock/p0-status.sock\npm.max_requests = 0\n');
        this.override = path.join(info.directory, 'compose.linear-warm.json');
        const mount = (source, target) => ({type: 'bind', source, target, read_only: true, bind: {create_host_path: false}});
        fs.writeFileSync(this.override, JSON.stringify({services: {phpfpm: {volumes: [
            mount(this.control, '/linear-control'), mount(path.join(this.control, 'php-fpm.conf'), '/usr/local/etc/php-fpm.conf')
        ]}}}));
        const recovery = JSON.parse(fs.readFileSync(this.recovery));
        fs.writeFileSync(this.recovery, JSON.stringify({...recovery, override: this.override, kind: 'warm-linear'}), {mode: 0o600});
    }
    async drain() {
        if (!this.warmReady) return super.drain();
        if (this.context) {
            let quiet = Date.now(); const deadline = quiet + 30000;
            while (Date.now() - quiet < 200) {
                if (Date.now() > deadline) throw new Error('Linear requests did not settle');
                if (this.browserState.requests.size) quiet = Date.now();
                await delay(25);
            }
            await this.context.close(); this.context = null;
        }
        if (!this.ingressPaused) { this.dc(['pause', 'app']); this.ingressPaused = true; }
        const deadline = Date.now() + 30000;
        while (true) {
            const status = this.status();
            if (status['active processes'] === 0 && status['listen queue'] === 0) break;
            if (Date.now() > deadline) throw new Error('Linear PHP did not drain');
            await delay(50);
        }
        await this.drainQueues();
        assert.equal(this.dc(['exec', '-T', 'db', 'sh', '-c',
            'exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --execute "SELECT COUNT(*) FROM information_schema.INNODB_TRX"']), '0');
        const ip = Object.values(this.container('phpfpm').NetworkSettings.Networks)[0].IPAddress;
        assert.match(ip, /^[0-9.]+$/);
        const query = "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='magento' AND HOST LIKE '" + ip + ":%'";
        assert.equal(this.dc(['exec', '-T', 'db', 'sh', '-c',
            'exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --execute "$1"', 'linear-connection-check', query]), '0');
        this.continuity();
    }
    async cleanup() {
        if (!this.ownsLock) return;
        if (!this.override) return super.cleanup();
        await this.restoreBaseline();
        if (this.ingressPaused) { this.dc(['unpause', 'app']); this.ingressPaused = false; }
        this.warmReady = false;
        await LinearCheckout.prototype.drain.call(this);
        this.override = null;
        super.dc(['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '180', 'phpfpm', 'app']);
        this.servicesStopped = false;
        assert.equal(this.container('db').State.StartedAt, this.originalDatabaseStartedAt, 'Linear database must remain running');
        this.events.push({event: 'linear-database-retained', startedAt: this.originalDatabaseStartedAt});
        for (const service of ['app', 'phpfpm']) {
            assert.ok(!this.container(service).Mounts.some(m => m.Source.startsWith(this.directory + path.sep)));
        }
        fs.rmSync(this.recovery); fs.rmSync(path.join(this.lock, 'linear.json')); fs.rmdirSync(this.lock); this.ownsLock = false;
    }
}
module.exports = {LinearCheckout: WarmLinear};
