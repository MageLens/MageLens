// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {setTimeout: delay} = require('node:timers/promises');
const {restoreContext, storageState} = require('./browser-context.cjs');
const {coverageCookie, withoutCoverageCookie} = require('../playwright/coverage-cookie.cjs');
const {CodeCache} = require('./code-cache.cjs');
const {disablePageTransitions} = require('../bin/browser-navigation.cjs');

class PlaywrightState {
    constructor(browser, {baseURL, timeout = 30000, contextOptions = {}, javascriptCoverageDirectory, templateCoverageDirectory, coverageRunId}) {
        this.browser = browser; this.baseURL = baseURL; this.timeout = timeout;
        this.options = {...contextOptions, baseURL, serviceWorkers: 'block'};
        this.javascriptCoverageDirectory = javascriptCoverageDirectory;
        this.templateCoverageDirectory = templateCoverageDirectory;
        this.coverageCookie = coverageRunId === undefined ? null : coverageCookie(baseURL, coverageRunId);
        this.cache = new CodeCache();
        this.requests = new Map(); this.errors = []; this.sessions = new Map(); this.sockets = new Set();
    }
    check() {
        if (this.errors.length) throw new Error(`Application browser error: ${this.errors[0]}`);
        if (this.context.pages().length !== 1) throw new Error('branching supports exactly one open page at a checkpoint');
    }
    get active() { return Boolean(this.context); }
    async closePages() { for (const page of this.context?.pages() ?? []) await page.close(); }
    async track(page) {
        page.on('pageerror', error => this.errors.push(error.message));
        page.on('crash', () => this.errors.push('Page crashed'));
        const session = await this.context.newCDPSession(page);
        this.sessions.set(page, session);
        await session.send('Network.enable');
        await this.cache.install(session);
        await session.send('Page.enable');
        session.on('Network.requestWillBeSent', ({requestId, loaderId}) => this.requests.set(requestId, loaderId));
        session.on('Network.loadingFinished', ({requestId}) => this.requests.delete(requestId));
        session.on('Network.loadingFailed', ({requestId}) => this.requests.delete(requestId));
        session.on('Network.webSocketCreated', ({requestId}) => this.sockets.add(requestId));
        session.on('Network.webSocketClosed', ({requestId}) => this.sockets.delete(requestId));
        // A cross-document navigation can retire requests without a finished event.
        session.on('Page.frameNavigated', ({frame}) => {
            if (!frame.parentId) for (const [id, loader] of this.requests) {
                if (loader && loader !== frame.loaderId) this.requests.delete(id);
            }
        });
    }
    async open(saved = {url: 'about:blank', storage: {cookies: [], origins: []}}) {
        if (this.context) await this.context.unrouteAll({behavior: 'wait'});
        const storage = this.coverageCookie ? withoutCoverageCookie(saved.storage) : saved.storage;
        const restored = await restoreContext(this.browser, this.context, storage, this.options);
        this.context = restored.context; this.requests.clear(); this.sessions.clear(); this.sockets.clear(); this.frozen = false;
        if (restored.created && this.javascriptCoverageDirectory) {
            const {collectJavaScriptCoverage} = require('../playwright/javascript-coverage.cjs');
            this.javascriptCoverage = await collectJavaScriptCoverage(this.context, {
                directory:this.javascriptCoverageDirectory, flushOnPageClose:false
            });
        }
        if (restored.created && this.templateCoverageDirectory) {
            const {registerTemplateCoverage} = require('@vitaliiboiko/magento-template-coverage/playwright');
            const context = this.context;
            // Checkpoint fencing flushes explicitly before freezing. Page-close
            // hooks must never evaluate scripts on a frozen document.
            this.templateCoverage = await registerTemplateCoverage({
                exposeBinding:context.exposeBinding.bind(context),
                addInitScript:context.addInitScript.bind(context),
                pages:() => this.frozen ? [] : context.pages(),
                on() {},
                off() {}
            }, {outputDir:this.templateCoverageDirectory});
        }
        if (this.coverageCookie) await this.context.addCookies([this.coverageCookie]);
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(this.timeout); this.page.setDefaultNavigationTimeout(this.timeout);
        await this.track(this.page);
        await this.page.addInitScript(disablePageTransitions);
        if (saved.url !== 'about:blank') {
            await this.page.goto(saved.url, {waitUntil: 'load'});
            // A rebuilt page can schedule initialization requests after load.
            // Let that work settle before the restored test suffix can interact
            // with fields that initialization may still overwrite.
            await this.settle(500);
        }
        this.check();
    }
    async settle(quietMs = 100) {
        this.check();
        const deadline = Date.now() + this.timeout;
        let quietSince = Date.now();
        while (Date.now() - quietSince < quietMs) {
            if (Date.now() >= deadline) throw new Error('Browser did not become quiescent');
            if (this.requests.size) quietSince = Date.now();
            await delay(20);
        }
        this.check();
    }
    async freeze() {
        this.check();
        if (this.frozen) return;
        await this.settle();
        // No live WebSockets or workers can be serialized at a checkpoint.
        if (this.page.workers().length || this.sockets.size) throw new Error('Active workers/WebSockets need a qualified checkpoint boundary');
        // Storage extraction may execute browser work. Finish it before freezing
        // and draining HTTP; only collect final response cookies after the drain.
        this.saved = {url: this.page.url(), storage: await storageState(this.context)};
        this.check();
        await this.javascriptCoverage?.flushPages();
        await this.templateCoverage?.flush();
        this.frozen = true;
        await this.sessions.get(this.page).send('Page.setWebLifecycleState', {state: 'frozen'});
    }
    async save() {
        this.check();
        if (!this.frozen) throw new Error('Browser must be frozen before capture');
        const storage = {...this.saved.storage, cookies: await this.context.cookies()};
        return {...this.saved, storage: this.coverageCookie ? withoutCoverageCookie(storage) : storage};
    }
    async resume() {
        if (!this.frozen) throw new Error('No retained page to resume');
        await this.sessions.get(this.page).send('Page.setWebLifecycleState', {state: 'active'});
        this.frozen = false; this.check();
    }
    async close() {
        try {
            try { await this.javascriptCoverage?.finish({flush:!this.frozen}); }
            finally { await this.templateCoverage?.stop(); }
        }
        finally {
            if (this.context) await this.context.close();
            this.context = null;
            this.javascriptCoverage = null;
            this.templateCoverage = null;
        }
    }
}
module.exports = {PlaywrightState};
