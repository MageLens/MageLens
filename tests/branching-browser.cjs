// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Focused Linux integration reproduction. Run explicitly in the branching driver image
// with a private CoW directory mounted at its host path and the Docker socket.
// This is a real MariaDB/Chrome check, not the Magento release E2E matrix.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const {randomUUID} = require('node:crypto');
const {chromium} = require('@playwright/test');
const {BranchingProvider} = require('../branching/provider.cjs');
const {execute} = require('./fixtures/branching/engine.cjs');
const {probe} = require('../branching/storage.cjs');

const command = args => execFileSync('docker', args, {encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
class Backend {
    constructor() { this.name = 'magelens-branching-check-' + randomUUID(); this.identity = {kind: 'real-mariadb-fixture'}; }
    sql(query) { return command(['exec', this.name, 'mariadb', '-uroot', '-ptest-only', '-Nse', query]); }
    async ready() {
        for (let i = 0; i < 120; i++) {
            try { this.sql('SELECT 1'); return; } catch { await delay(250); }
        }
        throw new Error('MariaDB failed to become ready');
    }
    async prepare({directory}) {
        const active = path.join(directory, 'active'); fs.mkdirSync(active);
        this.paths = Object.fromEntries(['database', 'media', 'session'].map(name => {
            const root = path.join(active, name); fs.mkdirSync(root); return [name, root];
        }));
        command(['run', '-d', '--name', this.name, '--network', 'none', '--memory', '512m', '--memory-swap', '512m',
            '-e', 'MARIADB_ROOT_PASSWORD=test-only', '--mount', `type=bind,source=${this.paths.database},target=/var/lib/mysql`,
            'mariadb:11.4', '--innodb-buffer-pool-size=64M']);
        this.created = true;
        await this.ready(); this.sql('CREATE DATABASE probe; CREATE TABLE probe.state (id INT PRIMARY KEY, value VARCHAR(40)); INSERT INTO probe.state VALUES (1,"initial");');
        fs.writeFileSync(path.join(this.paths.media, 'state'), 'initial'); fs.writeFileSync(path.join(this.paths.session, 'state'), 'initial');
        this.server = http.createServer((req, res) => {
            try {
                if (req.url === '/static/frontend/test/code.js') {
                    this.staticRequests = (this.staticRequests || 0) + 1;
                    res.setHeader('Cache-Control', 'public, max-age=3600, immutable'); res.setHeader('Content-Type', 'application/javascript');
                    return res.end('window.codeLoaded = true;');
                }
                if (req.url.startsWith('/set/')) {
                    const value = req.url.slice(5); assert.match(value, /^[a-z]+$/);
                    this.sql(`UPDATE probe.state SET value='${value}' WHERE id=1`);
                    for (const name of ['media', 'session']) fs.writeFileSync(path.join(this.paths[name], 'state'), value);
                    return res.end('ok');
                }
                res.setHeader('Content-Type', 'text/html');
                res.end('<!doctype html><title>branching fixture</title><h1>Checkout</h1><script src="/static/frontend/test/code.js"></script>');
            } catch (error) { res.statusCode = 500; res.end(error.message); }
        });
        await this.stop();
    }
    async drain() { if (this.server?.listening) await new Promise((resolve, reject) => this.server.close(error => error ? reject(error) : resolve())); }
    async pause() { this.sql('FLUSH ENGINE LOGS'); command(['pause', this.name]); this.paused = true; execFileSync('sync', ['-f', this.paths.database]); }
    async unpause() { if (this.paused) { command(['unpause', this.name]); this.paused = false; } }
    async stop() { await this.unpause(); command(['stop', '-t', '30', this.name]); }
    async resetCaches() {}
    async start() {
        command(['start', this.name]); await this.ready();
        if (!this.server.listening) await new Promise(resolve => this.server.listen(this.port || 0, '127.0.0.1', resolve));
        this.port = this.server.address().port;
    }
    async cleanup() { await this.drain(); if (this.created) { await this.unpause(); command(['rm', '-f', this.name]); this.created = false; } }
}
async function main() {
    const root = process.argv[2]; if (!root) throw new Error('Supply a dedicated CoW storage directory'); probe(root);
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    try {
        assert.equal(browser.version(), '156.0.8078.80');
        assert.equal(require('@playwright/test/package.json').version, '1.65.0');
        await require('./branching-browser-ready.cjs').checkReadiness(browser);
        const backend = new Backend();
        const provider = new BranchingProvider({browser, backend, baseURL: 'http://127.0.0.1', state: async () => ({
            database: backend.sql('SELECT * FROM probe.state ORDER BY id'),
            media: fs.readFileSync(path.join(backend.paths.media, 'state'), 'utf8'),
            session: fs.readFileSync(path.join(backend.paths.session, 'state'), 'utf8')
        })});
        let firstPage, context; const ids = [];
        const workflow = {identity: {source: 'real-browser-check-v1', fixture: 'mariadb-files-storage', configuration: 'three-siblings', dependencies: 'pw1.65-chrome156', implementation: 'branching'}, stages: [
            {id: 'customer-ready', run: async p => {
                // The fixture receives an ephemeral port only after reset.
                p.browserState.cache.origin = `http://127.0.0.1:${backend.port}`;
                await p.page.goto(`http://127.0.0.1:${backend.port}`);
                context = p.context;
                await p.page.evaluate(async () => {
                    localStorage.setItem('customer', 'same-customer'); document.cookie = 'session=parent; path=/';
                    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('customer', 1); r.onupgradeneeded = () => r.result.createObjectStore('state'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
                    await new Promise((resolve, reject) => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put('parent', 'cart'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
                    const root = await navigator.storage.getDirectory(); const file = await root.getFileHandle('cart', {create: true}); const writer = await file.createWritable(); await writer.write('parent'); await writer.close();
                });
            }, assert: async p => {
                assert.equal(p.context, context);
                assert.equal(await p.page.evaluate(() => localStorage.getItem('customer')), 'same-customer');
            }},
            {id: 'checkout-ready', parent: 'customer-ready', run: async p => {
                await p.page.evaluate(() => fetch('/set/checkout'));
                await p.page.evaluate(() => { window.livePrefix = true; }); firstPage = p.page;
            }, assert: async p => { assert.equal((await p.normalizedState()).media, 'checkout'); assert.equal(await p.page.title(), 'branching fixture'); }}
        ], specs: ['check', 'coupon', 'free'].map((name, index) => ({id: name, parent: 'checkout-ready', run: async p => {
            assert.equal(p.context, context);
            assert.equal(p.page === firstPage, index === 0, 'Only the first sibling retains its live page');
            assert.equal(await p.page.evaluate(() => Boolean(window.livePrefix)), index === 0);
            const saved = await p.page.evaluate(async () => {
                const db = await new Promise(resolve => { const r = indexedDB.open('customer'); r.onsuccess = () => resolve(r.result); });
                const value = await new Promise(resolve => { const r = db.transaction('state').objectStore('state').get('cart'); r.onsuccess = () => resolve(r.result); }); db.close();
                const root = await navigator.storage.getDirectory(); const file = await (await root.getFileHandle('cart')).getFile();
                return [document.cookie, value, await file.text()];
            });
            assert.deepEqual(saved, ['session=parent', 'parent', 'parent']);
            ids.push(p.allocateId('order'));
            await p.page.evaluate(async name => {
                await fetch('/set/' + name); localStorage.setItem('customer', name); document.cookie = 'session=' + name + '; path=/';
                const root = await navigator.storage.getDirectory(); const file = await root.getFileHandle('cart'); const writer = await file.createWritable(); await writer.write(name); await writer.close();
            }, name);
        }, assert: async p => { const state = await p.normalizedState(); assert.equal(state.media, name); assert.equal(state.session, name); assert.equal(state.database, '1\t' + name); }}))};
        const result = await execute({workflow, provider, root});
        assert.equal(result.status, 'passed', JSON.stringify(result.errors));
        assert.equal(result.counts.prefixExecutions, 2); assert.equal(result.counts.reuseHits, 2);
        assert.equal(result.counts.firstReuseValidations, 1); assert.equal(new Set(ids).size, 3);
        assert.equal(backend.staticRequests, 1); assert.ok(provider.browserState.cache.stats.hits >= 2);
        const summary = {status: result.status, browser: {name: 'Chrome for Testing', version: browser.version()},
            playwright: require('@playwright/test/package.json').version, tests: result.results.length,
            counts: result.counts, cache: provider.browserState.cache.stats, wallMs: result.metrics.wallMs};
        if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(summary, null, 2) + '\n');
        console.log(JSON.stringify(summary, null, 2));
    } finally { await browser.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {Backend};
