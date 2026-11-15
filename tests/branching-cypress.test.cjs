// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Bridge} = require('../branching/runners/cypress/bridge.cjs');
const {bindingsSnapshot} = require('../branching/runners/cypress/native-boundary.cjs');
const {install} = require('../branching/runners/cypress/native-plugin.cjs');
const {open} = require('../branching/runners/cypress/adapter.cjs');
const {CypressState} = require('../branching/runners/cypress/browser.cjs');

test('native Cypress snapshots shared fixture references and detects changes to them', () => {
    const customer = {region: 'west'};
    const snapshot = bindingsSnapshot(() => ({customer, config: {customers: [customer]}}));
    assert.equal(snapshot.eligible, true);
    const equivalent = {region: 'west'};
    assert.deepEqual(bindingsSnapshot(() => ({config: {customers: [equivalent]}, customer: equivalent})), snapshot);
    assert.notDeepEqual(bindingsSnapshot(() => ({customer, config: {customers: [{region: 'west'}]}})), snapshot);
    customer.region = 'east';
    assert.notDeepEqual(bindingsSnapshot(() => ({customer, config: {customers: [customer]}})), snapshot);
});

test('native Cypress still rejects cyclic fixtures and opaque values without invoking accessors', () => {
    const circular = {};
    circular.self = circular;
    assert.deepEqual(bindingsSnapshot(() => ({circular})), {eligible: false});
    assert.deepEqual(bindingsSnapshot(() => ({opaque() {}})), {eligible: false});
    let accessed = false;
    const fixture = {get computed() { accessed = true; return 1; }};
    assert.deepEqual(bindingsSnapshot(() => ({fixture, shared: fixture})), {eligible: false});
    assert.equal(accessed, false);
});

test('native Cypress publishes the last retry outcome when browser observations end at spec teardown', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cypress-observations-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const extension = path.join(directory, 'checkpoint.cjs');
    fs.writeFileSync(extension, 'module.exports = {assess() { return []; }, createProvider() {}};');
    const {install: installCheckpoints} = require('../branching/runners/cypress/native-checkpoints.cjs');
    const {identity} = require('../branching/runners/cypress/native-support.cjs');
    const lifecycle = new Map();
    await installCheckpoints((name, handler) => lifecycle.set(name, handler), {}, new Map(), {}, {directory,
        checkpoint: {module: extension, manifest: {root: directory, schemaVersion: 1, implementation: 'rust-prefix-v3',
            assessment: {version: 'measured-first-use-v1', status: 'complete', analysis: {collectionComplete: true}},
            sources: [], tests: [{id: 'test'}], checkpoints: []}}});
    const spec = {absolute: path.join(directory, 'original.cy.js')};
    const retryTitle = ['original suite', 'retry'];
    const stableTitle = ['original suite', 'stable'];
    const retry = identity(spec.absolute, retryTitle, 0);
    const stable = identity(spec.absolute, stableTitle, 0);
    lifecycle.get('task')['magelens:observations']([
        {type: 'spec-end', node: stable, attempt: 0, status: 'passed'},
        {type: 'spec-end', node: retry, attempt: 0, status: 'failed'},
        {type: 'spec-start', node: retry, attempt: 1}
    ]);
    const result = {spec, tests: [
        {title: stableTitle, state: 'passed', attempts: [{state: 'passed'}]},
        {title: retryTitle, state: 'passed', attempts: [{state: 'failed'}, {state: 'passed'}]}
    ]};
    lifecycle.get('after:spec')(spec, result);
    await lifecycle.get('after:run')({runs: [result]});
    const journal = path.join(directory, 'events');
    const entries = fs.readFileSync(path.join(journal, fs.readdirSync(journal)[0]), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(entries.map(({type, node, attempt, status}) => [type, node, attempt, status]), [
        ['spec-end', stable, 0, 'passed'],
        ['spec-end', retry, 0, 'failed'],
        ['spec-start', retry, 1, undefined],
        ['spec-end', retry, 1, 'failed']
    ]);
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'checkpoints.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.ok(report.errors.some(error => error.phase === 'retry'));
});

test('a failed native capture retains its cost and the completed prefix outcome', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cypress-capture-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const {NativeSession} = require('../branching/runners/cypress/native-session.cjs');
    const events = [];
    let time = 0, resumed = false;
    const binding = {eligible: true, value: []};
    const session = new NativeSession({directory, run: 'capture-regression', now: () => time, verifySources() {},
        plan: [{id: 'prefix', identity: 'checked-prefix', consumers: ['first', 'second']}],
        emit: (type, event) => events.push({type, ...event}), bridge: {continue() {}, call: () => binding},
        provider: {identity: {}, entryState: () => ({}), assertBoundary() {}, abandon() {}, captureBarrier() {},
            capture(payload) {
                fs.writeFileSync(path.join(payload, 'fixture.json'), '{}');
                time += 30000;
            },
            normalizedState: () => ({resumed}), resumeCapture() { resumed = true; }, restore() {}, cleanup() {}}});
    await session.boundary({phase: 'enter', checkpoint: 'prefix', consumer: 'first', bindings: binding});
    time += 60000;
    await assert.rejects(session.boundary({phase: 'complete', checkpoint: 'prefix', consumer: 'first',
        workMs: 60000, bindings: binding}), /state differs from captured state/i);
    const report = await session.close({passed: false});
    assert.deepEqual(events.filter(event => event.type === 'node-end').map(({operation, status, ms}) => [operation, status, ms]), [
        ['execute', 'passed', 60000],
        ['capture', 'failed', 30000]
    ]);
    assert.equal(report.prefixes.length, 1);
    assert.deepEqual(report.checkpoints, []);
    assert.deepEqual(report.restores, []);
    assert.equal(report.errors.length, 1);
    assert.equal(report.cleanup.storageReleased, true);
});

test('native Cypress preserves version 16 durations and failure details', () => {
    const {testResult} = require('../branching/runners/cypress/native.cjs');
    assert.deepEqual(testResult({state:'failed',duration:74785,displayError:'Shipment count mismatch',attempts:[{state:'failed'}]}),
        {status:'failed',durationMs:74785,attempts:1,errors:[{message:'Shipment count mismatch'}]});
    assert.deepEqual(testResult({state:'passed',duration:1200,displayError:null,attempts:[{state:'passed'}]}),
        {status:'passed',durationMs:1200,attempts:1,errors:[]});
});

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
        const support = fs.readFileSync(options.support, 'utf8');
        if (list) assert.match(support, /"discoveryBaseUrl":"https:\/\/store\.test"/);
        else assert.doesNotMatch(support, /discoveryBaseUrl/);
        const metadata = JSON.parse(fs.readFileSync(options.metadata));
        assert.equal(metadata.checkpointLifecycle, 'native-cypress');
        assert.deepEqual(metadata.unassessedLifecycle, ['Cypress setupNodeEvents and plugin lifecycle']);
        assert.equal(events.get('task').read(), 'fixture');
        if (list) assert.equal(events.has('before:run'), false);
        else { await events.get('before:run')(); assert.deepEqual(calls, ['first', 'second']); }
    }
});

for (const {selectedOnly,list} of [{selectedOnly:false},{selectedOnly:true},{selectedOnly:false,list:true}]) test(`Cypress profiling snapshots before project hooks (selection: ${selectedOnly}, discovery: ${!!list})`, () => {
    const vm = require('node:vm'), before = [], after = [], registrations = [], tasks = [];
    const context = {module:{exports:{}}, Cypress:{spec:{absolute:'/suite/example.cy.js'}},
        cy:{task(name, value) { tasks.push({name,value:structuredClone(value)}); return Promise.resolve(null); }}};
    for (const name of ['describe','context']) context[name] = (_,callback) => callback();
    for (const name of ['it','specify']) {
        context[name] = (...args) => {
            registrations.push(args);
            return {invocationDetails:{absoluteFile:'/suite/example.cy.js',line:12,column:4}};
        };
        context[name].skip = context[name];
    }
    context.before = callback => before.push(callback);
    context.after = callback => after.push(callback);
    context.beforeEach = context.afterEach = callback => registrations.push(callback);
    vm.runInNewContext(fs.readFileSync(require.resolve('../branching/runners/cypress/native-support.cjs'),'utf8'),context);
    const selected=selectedOnly?[context.module.exports.identity('/suite/example.cy.js',['suite','journey'],0)]:undefined;
    context.module.exports.install({profile:true,selected,list});
    const hook = () => { throw Error('Must not execute project code while registering'); };
    context.describe('suite', () => {
        context.before(hook);
        if(selectedOnly) context.it('unselected',()=>{});
        context.it('journey',hook);
    });
    if (list) {
        assert.equal(before.length,2);
        assert.doesNotThrow(before[1]);
        assert.doesNotThrow(registrations[0][1]);
    } else {
        assert.equal(before[1],hook);
        assert.equal(registrations[0][1],hook);
    }
    return before[0]().then(() => {
        assert.equal(tasks[0].name,'magelens:timing:prepare');
        assert.equal(tasks[0].value.tests.length,1);
        assert.match(tasks[0].value.tests[0].timingSource,/Must not execute/);
        assert.deepEqual(tasks[0].value.tests[0].timingLocation,{line:12,column:5});
        assert.deepEqual(tasks[0].value.hooks[0].scope,['suite']);
        return after[0]();
    }).then(() => {
        assert.equal(tasks[1].name,'magelens:inventory');
        assert.equal(tasks[1].value.tests[0].timingSource,undefined);
        assert.equal(tasks[1].value.tests[0].timingLocation,undefined);
    });
});


test('Cypress discovery preserves base URL reads before support files and test declarations', () => {
    const vm = require('node:vm');
    for (const list of [false, true]) {
        let baseUrl = null;
        const registrations = [];
        const context = {module: {exports: {}}, URL, Cypress: {spec: {absolute: '/suite/urls.cy.js'},
            config(key, value) {assert.equal(key, 'baseUrl'); if (arguments.length === 2) baseUrl = value; return baseUrl;}}};
        for (const name of ['describe', 'context']) context[name] = (_, callback) => callback();
        for (const name of ['it', 'specify']) {
            context[name] = (...args) => registrations.push(args);
            context[name].skip = context[name];
        }
        for (const name of ['before', 'after', 'beforeEach', 'afterEach']) context[name] = () => {};
        vm.runInNewContext(fs.readFileSync(require.resolve('../branching/runners/cypress/native-support.cjs'), 'utf8'), context);
        context.module.exports.install({list, discoveryBaseUrl: 'https://store.test/catalog/'});
        if (list) {
            vm.runInNewContext("describe('URL registration', () => {const target = new URL('/recommendations', Cypress.config('baseUrl')); it(target.pathname, () => {throw new Error('Discovery must not execute the body');});});", context);
            assert.equal(baseUrl, 'https://store.test/catalog/');
            assert.equal(registrations[0][0], '/recommendations');
            assert.doesNotThrow(() => registrations[0][1]());
        } else assert.equal(baseUrl, null, 'Normal execution must retain its native configuration');
    }
});


test('native Cypress retains compilation failures even when a spec registered no tests', () => {
    const {reportErrors} = require('../branching/runners/cypress/native.cjs');
    const errors = reportErrors({totalFailed:1,runs:[
        {spec:{absolute:'/suite/imports.cy.js'},tests:[],error:'Webpack Compilation Error: missing imported module'},
        {spec:{absolute:'/suite/valid.cy.js'},tests:[{}],error:null}
    ]},[{errors:['Focused Cypress tests are forbidden']}]);
    assert.deepEqual(errors,[{message:'Focused Cypress tests are forbidden'},
        {file:'/suite/imports.cy.js',message:'Webpack Compilation Error: missing imported module'}]);
    assert.deepEqual(reportErrors({failures:1,message:'Config load failed'},[]),[{message:'Config load failed'}]);
    assert.deepEqual(reportErrors({runs:[{spec:{absolute:'/suite/config.cy.js'},error:{message:'Preprocessor failed'}}]},[]),
        [{file:'/suite/config.cy.js',message:'Preprocessor failed'}]);
});
