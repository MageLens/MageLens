// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createCoverageMap} = require('istanbul-lib-coverage');

async function collectJavaScriptCoverage(context, {directory = '.nyc_output', flushOnPageClose = true} = {}) {
    const snapshots = new Map();
    const binding = '__magelensJS' + randomUUID().replaceAll('-', '');
    await context.exposeBinding(binding, (_source, snapshot) => snapshots.set(snapshot.id, snapshot.coverage));
    await context.addInitScript(({binding}) => {
        const id = crypto.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);
        const publish = () => window[binding]({id, coverage: window.__coverage__ || {}});
        window[binding + '_flush'] = publish;
        setInterval(() => publish().catch(() => {}), 250);
        addEventListener('pagehide', () => publish().catch(() => {}));
    }, {binding});
    const flush = async page => {
        for (const frame of page.frames()) {
            try { await frame.evaluate(key => window[key]?.(), binding + '_flush'); }
            catch (error) { if (!/closed|detached|destroyed|navigation/i.test(error.message)) throw error; }
        }
    };
    const closeMethods = new Map();
    const track = page => {
        const close = page.close;
        closeMethods.set(page, close);
        page.close = async function (...args) { await flush(page); return close.apply(this, args); };
    };
    if (flushOnPageClose) {
        context.on('page', track);
        for (const page of context.pages()) track(page);
    }
    async function flushPages() {
        for (const page of context.pages()) await flush(page);
    }
    async function finish({flush = true} = {}) {
        if (flush) await flushPages();
        context.off('page', track);
        for (const [page, close] of closeMethods) page.close = close;
        const coverage = createCoverageMap({});
        for (const snapshot of snapshots.values()) coverage.merge(snapshot);
        fs.mkdirSync(directory, {recursive: true});
        fs.writeFileSync(path.join(directory, `playwright-${randomUUID()}.json`), JSON.stringify(coverage));
    }
    return {finish, flushPages};
}

module.exports = {collectJavaScriptCoverage};
