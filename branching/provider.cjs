// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const config = require('./configs/runtime.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {PlaywrightState} = require('./browser.cjs');
const {probe} = require('./storage.cjs');
const {validateMutablePaths, captureState, restoreState} = require('./snapshot-state.cjs');
const {implementationDigest} = require('./identity.cjs');

// Backend owns application quiescence and private mutable directories. The
// browser and backend are fenced together; a filesystem clone alone is not a
// valid application checkpoint.
class BranchingProvider {
    constructor({browser, backend, baseURL, state, contextOptions}) {
        if (typeof state !== 'function') throw new Error(messages.missingStateReader);
        for (const name of config.provider.lifecycle) {
            if (typeof backend[name] !== 'function') throw new Error(messages.missingBackendLifecycle(name));
        }
        this.backend = backend;
        this.readState = state;
        this.browserState = new PlaywrightState(browser, {baseURL, contextOptions});
        this.approaches = config.executionApproaches;
        this.workload = config.provider.workload;
        this.capability = config.provider.capability;
        this.coverageKind = config.provider.coverage;
        this.identity = {
            implementation: implementationDigest(
                [
                    './provider.cjs',
                    './snapshot-state.cjs',
                    './storage.cjs',
                    './browser.cjs',
                    './browser-context.cjs',
                    './code-cache.cjs',
                    './configs/runtime.cjs'
                ].map((file) => require.resolve(file))
            ),
            backend: backend.identity,
            browser: browser.version()
        };
        this.serial = 0;
        this.paused = false;
    }
    get page() {
        return this.browserState.page;
    }
    get context() {
        return this.browserState.context;
    }
    // External to snapshots, so retries and siblings cannot recycle identifiers.
    allocateId(prefix = config.provider.idPrefix) {
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(prefix)) throw new Error(messages.invalidIdPrefix);
        return `${prefix}-${this.run}-${++this.serial}-${randomUUID()}`;
    }
    sql(query) {
        return this.backend.sql(query);
    }
    async prepare({run, directory}) {
        this.run = run;
        this.directory = directory;
        probe(path.dirname(directory));
        await this.backend.prepare({run, directory});
        validateMutablePaths(this.backend.paths, directory);
        this.base = path.join(directory, config.files.baseline);
        fs.mkdirSync(this.base);
        // prepare leaves application and database stopped on a private copy.
        captureState(this.backend.paths, this.base, {
            url: config.provider.blankUrl,
            storage: {cookies: [], origins: []}
        });
    }
    async normalizedState() {
        return this.readState(this);
    }
    async reset() {
        await this.restore(this.base);
    }
    async captureBarrier() {
        await this.browserState.freeze();
        await this.backend.drain();
        this.saved = await this.browserState.save();
    }
    async capture(directory) {
        this.paused = true;
        try {
            await this.backend.pause();
            captureState(this.backend.paths, directory, this.saved);
        } finally {
            await this.backend.unpause();
            this.paused = false;
        }
    }
    async resumeCapture() {
        await this.backend.start();
        await this.browserState.resume();
    }
    async restore(directory) {
        if (this.context) await this.browserState.freeze();
        await this.backend.drain();
        if (this.context) {
            for (const page of this.context.pages()) await page.close();
        }
        await this.backend.stop();
        const browser = restoreState(this.backend.paths, directory, this.directory);
        await this.backend.resetCaches();
        await this.backend.start();
        await this.browserState.open(browser);
    }
    async beginSegment() {
        if (this.context) this.browserState.check();
    }
    async endSegment() {
        this.browserState.check();
    }
    async cleanup() {
        this.diagnostics = {codeCache: this.browserState.cache.stats};
        try {
            await this.browserState.close();
        } finally {
            if (this.paused) {
                await this.backend.unpause();
                this.paused = false;
            }
            await this.backend.cleanup();
        }
    }
}
module.exports = {BranchingProvider};
