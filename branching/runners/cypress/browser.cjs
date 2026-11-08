// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {setTimeout: delay} = require('node:timers/promises');
const cookieFields = ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'expires', 'priority', 'sameParty', 'sourceScheme', 'sourcePort', 'partitionKey'];
class CypressState {
    constructor(bridge, cdp) {
        this.bridge = bridge; this.cdp = cdp; this.origins = new Set(); this.requests = new Map();
        this.cache = {stats: {mode: 'browser-per-branch', clears: 0}};
        this.page = {url: () => this.url, evaluate: code => this.evaluate(code)};
        cdp.on('Network.requestWillBeSent', event => this.requests.set(event.requestId, event.frameId));
        cdp.on('Network.loadingFinished', event => this.requests.delete(event.requestId));
        cdp.on('Network.loadingFailed', event => this.requests.delete(event.requestId));
    }
    get active() { return this.opened; }
    async initialize() {
        await this.cdp.send('Network.enable'); await this.cdp.send('Page.enable'); await this.cdp.send('DOMStorage.enable');
        // Record only the pinned runner's extension workers before loading any
        // application page. Application workers introduced later remain unsafe.
        const {targetInfos} = await this.cdp.send('Target.getTargets');
        this.runnerWorkers = new Set(targetInfos.filter(target => target.type === 'service_worker' && target.url.startsWith('chrome-extension://')).map(target => target.targetId));
    }
    check() { if (this.cdp.error || this.bridge.error) throw this.cdp.error ?? this.bridge.error; }
    async execute(code) { this.check(); await this.bridge.call('execute', {code}); await this.observe(); }
    evaluate(callback) { return this.bridge.call('evaluate', {code: String(callback)}); }
    async observe() {
        const state = await this.bridge.call('state'); this.url = state.url;
        if (state.unsupported.length) throw new Error(`Cypress checkpoint cannot restore ${state.unsupported.join(', ')}`);
        if (/^https?:/.test(this.url)) this.origins.add(new URL(this.url).origin);
        return state;
    }
    async frames() {
        const tree = await this.cdp.send('Page.getFrameTree'), frames = [];
        const visit = node => { frames.push(node.frame); for (const child of node.childFrames ?? []) visit(child); };
        visit(tree.frameTree);
        this.aut = frames.find(frame => frame.parentId && frame.url === this.url);
        if (this.url !== 'about:blank' && !this.aut) throw new Error('Cannot identify the Cypress application frame');
        const ids = new Set(this.aut ? [this.aut.id] : []);
        for (const frame of frames) if (ids.has(frame.parentId)) ids.add(frame.id);
        if (frames.some(frame => ids.has(frame.id) && /^https?:/.test(frame.url) && new URL(frame.url).origin !== new URL(this.url).origin))
            throw new Error('Cypress checkpoint cannot restore cross-origin child frames');
        return ids;
    }
    async settle() {
        const frames = await this.frames(), deadline = Date.now() + 30000;
        let quiet = Date.now();
        while (Date.now() - quiet < 500) {
            this.check();
            if (Date.now() >= deadline) throw new Error('Cypress application did not become quiescent');
            if ([...this.requests.values()].some(id => frames.has(id))) quiet = Date.now();
            await delay(20);
        }
    }
    async freeze() {
        this.check(); if (this.frozen) return;
        await this.observe(); await this.settle();
        const {targetInfos} = await this.cdp.send('Target.getTargets');
        if (targetInfos.filter(target => target.type === 'page').length !== 1 || targetInfos.some(target => ['worker', 'shared_worker', 'service_worker'].includes(target.type) && !this.runnerWorkers.has(target.targetId)))
            throw new Error('Cypress checkpoint cannot restore additional browser pages or workers');
        await this.cdp.send('Page.setWebLifecycleState', {state: 'frozen'}); this.frozen = true;
        const origins = [];
        for (const origin of this.origins) {
            const usage = await this.cdp.send('Storage.getUsageAndQuota', {origin});
            if (usage.usageBreakdown.some(item => ['indexeddb', 'file_systems', 'cache_storage', 'service_workers'].includes(item.storageType) && item.usage > 0))
                throw new Error('Cypress checkpoint cannot restore IndexedDB, OPFS, Cache Storage or service workers');
            const localStorage = await this.cdp.send('DOMStorage.getDOMStorageItems', {storageId: {securityOrigin: origin, isLocalStorage: true}});
            const sessionStorage = await this.cdp.send('DOMStorage.getDOMStorageItems', {storageId: {securityOrigin: origin, isLocalStorage: false}});
            origins.push({origin, localStorage: localStorage.entries, sessionStorage: sessionStorage.entries});
        }
        this.saved = {url: this.url, storage: {origins}};
    }
    async save() {
        if (!this.frozen) throw new Error('Cypress browser must be frozen before capture');
        const {cookies} = await this.cdp.send('Storage.getCookies');
        return {...this.saved, storage: {...this.saved.storage, cookies}};
    }
    async resume() { if (this.frozen) await this.cdp.send('Page.setWebLifecycleState', {state: 'active'}); this.frozen = false; }
    async closePages() {
        if (this.aut) {
            // Use the pinned driver's own session-isolation navigation. A raw
            // CDP navigation bypasses Cypress's load/stability bookkeeping.
            const result = await this.cdp.send('Runtime.evaluate', {expression: `(() => { Cypress.action('cy:url:changed', ''); Cypress.action('cy:visit:blank', {testIsolation: true}); })()`});
            if (result.exceptionDetails) throw new Error('Cypress could not detach its application frame');
            const deadline = Date.now() + 5000;
            while (true) {
                const {frameTree} = await this.cdp.send('Page.getFrameTree');
                const pending = [frameTree]; let old;
                while (pending.length) { const frame = pending.pop(); if (frame.frame.id === this.aut.id) old = frame.frame; pending.push(...(frame.childFrames ?? [])); }
                if (!old || old.url === 'about:blank') break;
                if (Date.now() >= deadline) throw new Error('Cypress application frame did not detach while frozen');
                await delay(20);
            }
        }
        await this.resume(); this.requests.clear(); this.aut = null;
    }
    async open(saved = {url: 'about:blank', storage: {cookies: [], origins: []}}) {
        await this.resume();
        for (const origin of this.origins) await this.cdp.send('Storage.clearDataForOrigin', {origin, storageTypes: 'all'});
        await this.cdp.send('Network.clearBrowserCache'); this.cache.stats.clears++;
        await this.cdp.send('Network.clearBrowserCookies');
        const cookies = (saved.storage?.cookies ?? []).map(cookie => Object.fromEntries(cookieFields.filter(key => key in cookie).map(key => [key, cookie[key]])));
        if (cookies.length) await this.cdp.send('Storage.setCookies', {cookies});
        const origins = saved.storage?.origins ?? [];
        const {identifier} = await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', {source: `(() => { const saved = ${JSON.stringify(origins)}.find(item => item.origin === location.origin); if (!saved) return; for (const kind of ['localStorage','sessionStorage']) { window[kind].clear(); for (const [key,value] of saved[kind]) window[kind].setItem(key,value); } })();`});
        try { if (saved.url !== 'about:blank') await this.bridge.call('visit', {url: saved.url}); }
        finally { await this.cdp.send('Page.removeScriptToEvaluateOnNewDocument', {identifier}); }
        this.opened = true; await this.observe(); await this.settle();
    }
    async close() { await this.resume(); this.opened = false; }
}
module.exports = {CypressState};
