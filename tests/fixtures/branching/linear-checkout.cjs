// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Conventional control: SQL import, ordinary tar files and a fresh browser
// context per test. No P0 provider, reflinks, restoreContext or custom code cache.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const {fileDigest} = require('../../../branching/engine.cjs');
const {disablePageTransitions} = require('../../../bin/browser-navigation.cjs');
const {CONSUMERS} = require('./checkout-state.cjs');

class LinearCheckout {
    constructor({workspace, browser, baseURL}) {
        this.workspace = fs.realpathSync(workspace); this.browser = browser; this.baseURL = baseURL;
        const owner = JSON.parse(fs.readFileSync(path.join(workspace, '.runtime/experience-owner.json')));
        assert.equal(owner.arm, 'conventional-linear'); this.project = owner.project;
        this.backend = this; this.queueDrains = []; this.servicesStopped = false;
        this.approaches = ['L0']; this.workload = 'playwright-workflow';
        this.capability = 'conventional-sql-reset'; this.coverageKind = 'unsupported';
        this.identity = {implementation: fileDigest(__filename), reset: 'sql-import-and-tar',
            browserContext: 'fresh-per-test', customCodeCache: false, browser: browser.version()};
        this.timings = {}; this.operations = [];
    }
    dc(args, options = {}) {
        const start = performance.now();
        try {
            const output = execFileSync('bash', ['-c',
                'source "$1/bin/common"; shift; export LOCAL_UID="${MAGELENS_HOST_UID:-$LOCAL_UID}" LOCAL_GID="${MAGELENS_HOST_GID:-$LOCAL_GID}"; dc "$@"',
                'linear-compose', this.workspace, ...args], {cwd: this.workspace, encoding: 'utf8',
                timeout: 180000, maxBuffer: 4 * 1024 * 1024, ...options});
            return output?.trim() ?? '';
        } finally { this.operations.push({command: args, ms: performance.now() - start}); }
    }
    php(action, data) {
        const prefix = this.servicesStopped ? ['run', '--rm', '--no-deps', 'phpfpm'] : ['exec', '-T', 'phpfpm'];
        return JSON.parse(this.dc([...prefix, 'php', '/application/docker/branching-checkout-fixture.php', action,
            ...(data === undefined ? [] : [JSON.stringify(data)])]));
    }
    async normalizedState() { return this.php('state'); }
    async drainQueues() {
        for (let round = 0; round < 8; round++) {
            const queues = this.php('queues');
            if (!queues.length) return;
            for (const queue of queues) {
                assert.equal(queue.status, 2); assert.ok(CONSUMERS.has(queue.name));
                assert.ok(Number.isSafeInteger(queue.count) && queue.count > 0 && queue.count < 10000);
                const prefix = this.servicesStopped ? ['run', '--rm', '--no-deps', 'phpfpm'] : ['exec', '-T', 'phpfpm'];
                this.dc([...prefix, 'php', 'bin/magento', 'queue:consumers:start', queue.name, '--max-messages=' + queue.count]);
                this.queueDrains.push(queue);
            }
        }
        throw new Error('Checkout queue drain did not converge');
    }
    async drain() {
        if (this.context) {
            // Ordinary test teardown: finish browser work, then close the context.
            // Server-side work still drains before the database is replaced.
            let quiet = Date.now(); const deadline = quiet + 30000;
            while (Date.now() - quiet < 200) {
                if (Date.now() > deadline) throw new Error('Linear browser requests did not settle');
                if (this.browserState.requests.size) quiet = Date.now();
                await delay(25);
            }
            await this.context.close(); this.context = null;
        }
        if (this.servicesStopped) return;
        for (const service of ['app', 'phpfpm']) {
            const id = this.dc(['ps', '-q', service]); assert.match(id, /^[a-f0-9]{12,64}$/);
            execFileSync('docker', ['stop', '--signal', 'SIGQUIT', '--timeout', '60', id], {stdio: 'pipe', timeout: 70000});
            const state = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .State}}', id], {encoding: 'utf8'}));
            assert.ok(!state.Running && !state.OOMKilled && state.ExitCode === 0, 'Service must drain cleanly');
        }
        this.servicesStopped = true;
        await this.drainQueues();
        assert.equal(this.dc(['exec', '-T', 'db', 'sh', '-c',
            'exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --execute "SELECT COUNT(*) FROM information_schema.INNODB_TRX"']), '0');
    }
    async prepare({run, directory}) {
        this.run = run; this.directory = directory;
        this.lock = path.join(this.workspace, '.runtime/workflow.lock');
        this.recovery = path.join(this.workspace, '.runtime/linear-recovery.json');
        assert.ok(!fs.existsSync(this.recovery), 'Recover the previous linear run first');
        fs.mkdirSync(this.lock); this.ownsLock = true;
        fs.writeFileSync(path.join(this.lock, 'linear.json'), JSON.stringify({run, directory}), {mode: 0o600});
        await this.drain();
        this.sqlFile = path.join(directory, 'baseline.sql');
        const fd = fs.openSync(this.sqlFile, 'wx', 0o600);
        try {
            this.dc(['exec', '-T', 'db', 'sh', '-c',
                'exec mariadb-dump -uroot --password="$MYSQL_ROOT_PASSWORD" --single-transaction --skip-lock-tables --routines --triggers magento'], {stdio: ['ignore', fd, 'pipe']});
        } finally { fs.closeSync(fd); }
        this.files = path.join(directory, 'baseline.tar');
        execFileSync('tar', ['-cf', this.files, '-C', path.join(this.workspace, 'src'), 'pub/media', 'var/session']);
        this.baselineReady = true;
        fs.writeFileSync(this.recovery, JSON.stringify({run, directory, project: this.project, sql: this.sqlFile, files: this.files}), {mode: 0o600, flag: 'wx'});
    }
    async restoreBaseline() {
        await this.drain();
        this.dc(['exec', '-T', 'db', 'sh', '-c',
            'exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" --execute "DROP DATABASE magento; CREATE DATABASE magento;"']);
        const fd = fs.openSync(this.sqlFile, 'r');
        try {
            this.dc(['exec', '-T', 'db', 'sh', '-c', 'exec mariadb -uroot --password="$MYSQL_ROOT_PASSWORD" magento'], {stdio: [fd, 'pipe', 'pipe']});
        } finally { fs.closeSync(fd); }
        for (const relative of ['pub/media', 'var/session']) fs.rmSync(path.join(this.workspace, 'src', relative), {recursive: true});
        execFileSync('tar', ['-xf', this.files, '-C', path.join(this.workspace, 'src')]);
        this.dc(['exec', '-T', 'redis', 'redis-cli', 'FLUSHALL']);
        this.dc(['up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'phpfpm', 'app']);
        this.servicesStopped = false;
    }
    async reset() {
        await this.restoreBaseline();
        this.context = await this.browser.newContext({baseURL: this.baseURL, ignoreHTTPSErrors: true, serviceWorkers: 'block'});
        const requests = new Map(), errors = [];
        this.browserState = {requests, check() { if (errors.length) throw new Error('Application browser error: ' + errors[0]); }};
        this.page = await this.context.newPage(); this.page.setDefaultTimeout(30000);
        this.page.on('pageerror', error => errors.push(error.message));
        this.page.on('crash', () => errors.push('Page crashed'));
        const session = await this.context.newCDPSession(this.page);
        await session.send('Network.enable'); await session.send('Page.enable');
        session.on('Network.requestWillBeSent', ({requestId, loaderId}) => requests.set(requestId, loaderId));
        session.on('Network.loadingFinished', ({requestId}) => requests.delete(requestId));
        session.on('Network.loadingFailed', ({requestId}) => requests.delete(requestId));
        session.on('Page.frameNavigated', ({frame}) => {
            if (!frame.parentId) for (const [id, loader] of requests) if (loader && loader !== frame.loaderId) requests.delete(id);
        });
        await this.page.addInitScript(disablePageTransitions);
    }
    async beginSegment() { this.browserState.check(); }
    async endSegment() { this.browserState.check(); }
    async cleanup() {
        if (!this.ownsLock) return;
        if (this.baselineReady) await this.restoreBaseline();
        else if (this.servicesStopped) this.dc(['up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'phpfpm', 'app']);
        if (fs.existsSync(this.recovery)) fs.rmSync(this.recovery);
        fs.rmSync(path.join(this.lock, 'linear.json')); fs.rmdirSync(this.lock); this.ownsLock = false;
    }
}
module.exports = {LinearCheckout};
