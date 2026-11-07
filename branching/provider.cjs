// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {PlaywrightState} = require('./browser.cjs');
const {clone, replace, probe} = require('./storage.cjs');
const {fileDigest} = require('./engine.cjs');
const {ActionMeter} = require('./action-meter.cjs');

// Backend owns application quiescence and private mutable directories. The
// browser and backend are fenced together; a filesystem clone alone is not a
// valid application checkpoint.
class P0Provider {
    constructor({browser, backend, baseURL, state, contextOptions, measureActions = false}) {
        if (typeof state !== 'function') throw new Error('A semantic state reader is required');
        for (const name of ['prepare', 'drain', 'pause', 'unpause', 'stop', 'start', 'resetCaches', 'cleanup']) {
            if (typeof backend[name] !== 'function') throw new Error(`Missing backend lifecycle: ${name}`);
        }
        this.backend = backend; this.readState = state;
        this.browserState = new PlaywrightState(browser, {baseURL, contextOptions});
        this.approaches = ['P0', 'L0']; this.workload = 'playwright-workflow';
        this.capability = 'filesystem-cow-browser-reconstruction'; this.coverageKind = 'unsupported';
        this.identity = {implementation: fileDigest(__filename), backend: backend.identity, browser: browser.version()};
        this.serial = 0; this.paused = false;
        this.actionMeter = measureActions ? new ActionMeter(browser) : null;
    }
    get page() { return this.browserState.page; }
    get context() { return this.browserState.context; }
    // External to snapshots, so retries and siblings cannot recycle identifiers.
    allocateId(prefix = 'branch') {
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(prefix)) throw new Error('Invalid ID prefix');
        return `${prefix}-${this.run}-${++this.serial}-${randomUUID()}`;
    }
    sql(query) { return this.backend.sql(query); }
    async prepare({run, directory}) {
        this.run = run; this.directory = directory;
        probe(path.dirname(directory));
        await this.backend.prepare({run, directory});
        const roots = Object.entries(this.backend.paths || {});
        if (!roots.length) throw new Error('Backend supplied no mutable state');
        for (const [name, root] of roots) {
            if (!/^[a-z][a-z0-9-]*$/.test(name) || !fs.realpathSync(root).startsWith(fs.realpathSync(directory) + path.sep)) {
                throw new Error('Mutable state must be owned by this run');
            }
            probe(root);
        }
        this.base = path.join(directory, 'baseline'); fs.mkdirSync(this.base);
        // prepare leaves application and database stopped on a private copy.
        for (const [name, root] of roots) clone(root, path.join(this.base, name));
        fs.writeFileSync(path.join(this.base, 'browser.json'), JSON.stringify({url: 'about:blank', storage: {cookies: [], origins: []}}));
    }
    async normalizedState() { return this.readState(this); }
    async reset() { await this.restore(this.base); }
    async captureBarrier() {
        await this.browserState.freeze();
        await this.backend.drain();
        this.saved = await this.browserState.save();
    }
    async capture(directory) {
        this.paused = true;
        try {
            await this.backend.pause();
            for (const [name, source] of Object.entries(this.backend.paths)) clone(source, path.join(directory, name));
            fs.writeFileSync(path.join(directory, 'browser.json'), JSON.stringify(this.saved), {mode: 0o600});
        } finally { await this.backend.unpause(); this.paused = false; }
    }
    async resumeCapture() { await this.backend.start(); await this.browserState.resume(); }
    async restore(directory) {
        if (this.context) await this.browserState.freeze();
        await this.backend.drain();
        if (this.context) {
            for (const page of this.context.pages()) await page.close();
        }
        await this.backend.stop();
        for (const [name, destination] of Object.entries(this.backend.paths)) replace(path.join(directory, name), destination, this.directory);
        await this.backend.resetCaches();
        await this.backend.start();
        await this.browserState.open(JSON.parse(fs.readFileSync(path.join(directory, 'browser.json'))));
    }
    async beginSegment() { if (this.context) this.browserState.check(); this.actionMeter?.start(); }
    async endSegment() { this.browserState.check(); }
    segmentMetrics() { return this.actionMeter?.finish() ?? null; }
    async cleanup() {
        this.actionMeter?.close();
        this.diagnostics = {codeCache: this.browserState.cache.stats};
        try { await this.browserState.close(); }
        finally {
            if (this.paused) { await this.backend.unpause(); this.paused = false; }
            await this.backend.cleanup();
        }
    }
}
module.exports = {P0Provider};
