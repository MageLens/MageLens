// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Bridge} = require('../branching/runners/cypress/bridge.cjs');
const {install} = require('../branching/runners/cypress/native-plugin.cjs');
const {open} = require('../branching/runners/cypress/adapter.cjs');
const {CypressState} = require('../branching/runners/cypress/browser.cjs');

test('Cypress rejects unsupported lifecycle and non-JSON configuration before browser startup', async () => {
    for (const e2e of [{supportFile: 'support.js'}, {supportFile: false, setupNodeEvents() {}}, {supportFile: false, testIsolation: false}])
        await assert.rejects(open({}, {config: {e2e}}), /test isolation.*support hooks/);
    await assert.rejects(open({}, {config: {e2e: {supportFile: false}, env: {callback() {}}}}), /must contain JSON/);
});

test('Cypress excludes its initial automation worker but rejects application workers and pages', async () => {
    const page = {targetId: 'runner', type: 'page', url: 'http://runner.test/'}, extension = {targetId: 'extension', type: 'service_worker', url: 'chrome-extension://runner/worker.js'};
    let targets = [page, extension];
    const sent = [];
    const state = new CypressState({}, {on() {}, async send(method) { sent.push(method); return {targetInfos: targets}; }});
    await state.initialize();
    state.observe = async () => {}; state.settle = async () => {};
    await state.freeze();
    assert.equal(state.frozen, true);
    await state.resume();
    for (const target of [{type: 'service_worker', targetId: 'app-worker', url: 'https://shop.test/worker.js'}, {type: 'page', targetId: 'popup', url: 'https://shop.test/popup'}]) {
        targets = [page, extension, target];
        const before = sent.filter(method => method === 'Page.setWebLifecycleState').length;
        await assert.rejects(state.freeze(), /additional browser pages or workers/);
        assert.equal(sent.filter(method => method === 'Page.setWebLifecycleState').length, before);
        assert.equal(state.frozen, false);
    }
});

function post(bridge, route, value, token = bridge.token) {
    return fetch(bridge.url + route, {method: 'POST', headers: {authorization: token}, body: JSON.stringify(value)});
}

test('Cypress bridge authenticates the queue and matches command results', async t => {
    const bridge = await new Bridge({timeout: 2000}).listen();
    t.after(() => bridge.close());
    assert.equal((await post(bridge, '/next', {}, 'invalid')).status, 403);
    await post(bridge, '/browser', {port: 1234});
    const next = post(bridge, '/next', {}).then(response => response.json());
    await bridge.ready;
    assert.deepEqual(await bridge.browser, {port: 1234});
    const command = bridge.call('evaluate', {code: 'fixture'});
    const message = await next;
    assert.equal(message.operation, 'evaluate');
    const waiting = post(bridge, '/next', {id: message.id, value: {restored: true}}).then(response => response.json());
    assert.deepEqual(await command, {restored: true});
    bridge.fail(new Error('browser stopped'));
    assert.deepEqual(await waiting, {operation: 'close'});
    await assert.rejects(bridge.call('execute'), /browser stopped/);
});

test('Cypress bridge startup is bounded even when only the queue connects', async t => {
    const bridge = await new Bridge({timeout: 100}).listen();
    t.after(() => bridge.close());
    const failure = assert.rejects(bridge.browser, /did not become ready/);
    const next = post(bridge, '/next', {}).then(response => response.json());
    await bridge.ready;
    await failure;
    assert.deepEqual(await next, {operation: 'close'});
});

test('Cypress bridge failure rejects all outstanding commands', async t => {
    const bridge = await new Bridge({timeout: 2000}).listen();
    t.after(() => bridge.close());
    const first = assert.rejects(bridge.call('first'), /worker exited/);
    const second = assert.rejects(bridge.call('second'), /worker exited/);
    bridge.fail(new Error('worker exited'));
    await Promise.all([first, second]);
});

test('Cypress native plugin composes hooks and suppresses execution hooks during discovery', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cypress-plugin-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    for (const list of [false, true]) {
        const events = new Map(), calls = [];
        const config = {projectRoot: directory, supportFile: false, baseUrl: 'https://store.test'};
        const options = {list, directory, metadata: path.join(directory, 'metadata.json'), support: path.join(directory, 'support.cjs'), inventory: path.join(directory, 'inventory.json')};
        const configured = await install((name, handler) => events.set(name, handler), config, on => {
            on('before:run', () => calls.push('first'));
            on('before:run', () => calls.push('second'));
            on('task', {read: () => 'fixture'});
        }, options);
        assert.equal(configured.baseUrl, list ? null : 'https://store.test');
        assert.equal(JSON.parse(fs.readFileSync(options.metadata)).checkpointLifecycle, 'native-cypress');
        assert.equal(events.get('task').read(), 'fixture');
        if (list) assert.equal(events.has('before:run'), false);
        else { await events.get('before:run')(); assert.deepEqual(calls, ['first', 'second']); }
    }
});
