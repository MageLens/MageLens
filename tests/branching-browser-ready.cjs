// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const http = require('node:http');
const {PlaywrightState} = require('../branching/browser.cjs');

async function checkReadiness(browser) {
    const server = http.createServer((request, response) => {
        if (request.url === '/initialize') {
            // A load-triggered request reproduces initialization that outlives
            // document load. It must finish before a restored suffix can run.
            return setTimeout(() => response.end('initialized'), 250);
        }
        if (request.url === '/blocked') return;
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><title>Restore readiness</title><script>
            window.initialized = false;
            addEventListener('load', async () => {
                // Module initialization may schedule work after an initially
                // empty request queue, as restored checkout pages do.
                await new Promise(resolve => setTimeout(resolve, 250));
                const response = await fetch('${request.url === '/hung' ? '/blocked' : '/initialize'}');
                window.initialized = (await response.text()) === 'initialized';
            });
        </script>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const state = new PlaywrightState(browser, {baseURL: origin, timeout: 2000});
    try {
        const saved = {url: origin + '/ready', storage: {cookies: [], origins: []}};
        for (let index = 0; index < 2; index++) {
            await state.open(saved);
            assert.equal(await state.page.evaluate(() => window.initialized), true,
                'Restoration returned before load-triggered application initialization completed');
            assert.equal(state.requests.size, 0);
        }
        state.timeout = 300;
        await assert.rejects(state.open({...saved, url: origin + '/hung'}), /quiescent/,
            'A restored page with unfinished initialization must fail within the configured timeout');
        return {checks: 3, status: 'passed'};
    } finally {
        await state.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

if (require.main === module) {
    (async () => {
        const {chromium} = require('@playwright/test');
        const browser = await chromium.launch({channel: 'chrome', headless: true});
        try {
            assert.equal(browser.version(), '156.0.8078.80');
            assert.equal(require('@playwright/test/package.json').version, '1.65.0');
            console.log(JSON.stringify(await checkReadiness(browser)));
        } finally { await browser.close(); }
    })().catch(error => {console.error(error); process.exitCode = 1;});
}
module.exports = {checkReadiness};
