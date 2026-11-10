// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Focused runner regression. Run in the same pinned Cypress image as installation.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {open, native} = require('../branching/runners/cypress/adapter.cjs');
async function run() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cypress-regression-'));
    const server = http.createServer((request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Branch fixture</title><h1>Cart</h1><script>window.initialStorage = localStorage.getItem("cart"); window.initialSession = sessionStorage.getItem("tab");</script>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let runner;
    try {
        const baseURL = `http://127.0.0.1:${server.address().port}`;
        runner = await open({...process.env, CYPRESS_BASE_URL: baseURL});
        await runner.state.open();
        await runner.state.execute(`cy.visit(${JSON.stringify(baseURL)}); cy.setCookie('session','original'); cy.window().then(win => { win.localStorage.setItem('cart','original'); win.sessionStorage.setItem('tab','original'); });`);
        await runner.state.freeze(); const snapshot = await runner.state.save(); await runner.state.resume();
        assert.equal(snapshot.storage.cookies.find(cookie => cookie.name === 'session').value, 'original');
        await runner.state.execute("cy.setCookie('session','changed'); cy.window().then(win => { win.localStorage.setItem('cart','changed'); win.sessionStorage.setItem('tab','changed'); });");
        await runner.state.freeze(); await runner.state.closePages(); await runner.state.open(snapshot);
        const state = await runner.state.evaluate(win => ({local: win.initialStorage, session: win.initialSession, cookie: win.document.cookie}));
        assert.deepEqual(state, {local: 'original', session: 'original', cookie: 'session=original'});
        assert.equal(runner.state.cache.stats.clears, 2);
        await assert.rejects(() => runner.state.execute("cy.window().then(win => { new win.Worker('data:text/javascript,self.onmessage=()=>{}'); });"), /cannot restore Worker/);
        await runner.close(); runner = null;

        const configuration = path.join(directory, 'cypress.config.cjs'), support = path.join(directory, 'support.cjs'), spec = path.join(directory, 'inventory.cy.js'), events = path.join(directory, 'events.jsonl');
        fs.writeFileSync(configuration, `const fs = require('node:fs'); module.exports = {video:false, e2e:{baseUrl:${JSON.stringify(baseURL)}, specPattern:${JSON.stringify(spec)}, supportFile:${JSON.stringify(support)}, setupNodeEvents(on, config) {
            const record = value => { fs.appendFileSync(${JSON.stringify(events)}, JSON.stringify(value)+'\\n'); return null; };
            on('task', {record}); on('before:run', () => record('before:run')); on('after:run', () => record('after:run')); return config;
        }}};`);
        fs.writeFileSync(support, "beforeEach(() => cy.task('record','beforeEach')); afterEach(() => cy.task('record','afterEach'));\n");
        fs.writeFileSync(spec, "describe('inventory', () => { for (const name of ['one','two']) it(name, () => { cy.task('record',name); cy.visit('/'); cy.contains('h1','Cart').should('be.visible'); }); it('repeat', () => cy.task('record','repeat-one')); it('repeat', () => cy.task('record','repeat-two')); it.skip('pending', () => { throw new Error('must stay skipped'); }); });\n");
        const collected = await native.collect(configuration, path.join(directory, 'collection'));
        assert.equal(collected.status, 'passed', JSON.stringify(collected.errors));
        assert.deepEqual(collected.tests.map(test => test.title), ['inventory › one', 'inventory › two', 'inventory › repeat', 'inventory › repeat', 'inventory › pending']);
        assert.equal(collected.tests[4].expectedStatus, 'skipped');
        assert.equal(fs.existsSync(events), false, 'Collection must not execute test bodies or lifecycle hooks');
        const executed = await native.run(configuration, path.join(directory, 'execution'), {tests: [collected.tests[1], collected.tests[3]]});
        assert.equal(executed.status, 'passed', JSON.stringify(executed.errors));
        assert.deepEqual(executed.results.map(test => [test.id, test.status]), [[collected.tests[1].id, 'passed'], [collected.tests[3].id, 'passed']]);
        assert.deepEqual(fs.readFileSync(events, 'utf8').trim().split('\n').map(line => JSON.parse(line)), ['before:run', 'beforeEach', 'two', 'afterEach', 'beforeEach', 'repeat-two', 'afterEach', 'after:run']);
        console.log('Cypress checkpoint restoration, native inventory, selection and lifecycle passed.');
    } finally {
        try { await runner?.close(); }
        finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, {recursive: true, force: true}); }
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
