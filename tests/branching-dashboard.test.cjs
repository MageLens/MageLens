// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {execute} = require('../branching/engine.cjs');
const {applyEvent} = require('../branching/dashboard/model.cjs');
const {startDashboard} = require('../branching/dashboard/server.cjs');
const {events: recorder} = require('../branching/events.cjs');
const {FixtureProvider, fixtureWorkflow} = require('./fixtures/branching/provider.cjs');

function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-dashboard-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    return {root: path.join(root, 'checkpoints'), eventDirectory: path.join(root, 'events'),
        workflow: fixtureWorkflow(), provider: new FixtureProvider(), checkpointLifetime: 'last-consumer'};
}
test('journal publishing continues while Docker-style synchronous work blocks the runner', async t => {
    const input = setup(t), received = [];
    const observer = recorder({run: 'asynchronous', directory: input.eventDirectory, onEvent: e => received.push(e)});
    const counts = {reuseHits: 1}; observer.emit('first', {counts}); counts.reuseHits = 999;
    const file = path.join(input.eventDirectory, 'asynchronous.ndjson');
    // The child can observe the worker's write while this runner is blocked in
    // execFileSync, just as it is during synchronous Docker commands.
    require('node:child_process').execFileSync(process.execPath, ['-e', `
        const fs = require('node:fs'), deadline = Date.now() + 4000;
        while (true) {
            if (fs.existsSync(process.argv[1]) && fs.readFileSync(process.argv[1], 'utf8').endsWith('\\n')) break;
            if (Date.now() > deadline) process.exit(1);
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
    `, file], {timeout: 5000});
    observer.emit('second'); await observer.close();
    assert.deepEqual(received.map(e => e.sequence), [1, 2]); assert.equal(received[0].counts.reuseHits, 1);
    assert.equal(observer.diagnostics.events, 2); assert.equal(observer.diagnostics.error, null);
});
test('live events reflect real reuse and last-consumer deletion without publishing application state', async t => {
    const input = setup(t), events = [];
    const report = await execute({...input, onEvent: event => events.push(event)});
    const state = events.reduce(applyEvent, null);
    assert.equal(report.status, 'passed'); assert.equal(state.status, 'passed');
    assert.deepEqual(state.counts, report.counts);
    assert.equal(state.nodes.filter(node => node.checkpointState === 'released').length, report.releases.length);
    for (const release of report.releases) {
        const index = events.findIndex(e => e.type === 'checkpoint-released' && e.node === release.stage);
        assert.ok(events.slice(0, index).some(e => e.type === 'spec-end' && e.node === release.after));
        assert.equal(state.nodes.find(n => n.id === release.stage).remaining, 0);
    }
    const journal = fs.readFileSync(path.join(input.eventDirectory, report.run + '.ndjson'), 'utf8');
    assert.equal(journal.includes('synthetic-session'), false); assert.equal(journal.includes('expectedStateDigest'), false);
    assert.deepEqual(journal.trim().split('\n').map(line => JSON.parse(line)), events);
    assert.equal(fs.existsSync(report.directory), false); assert.equal(state.cleanup.storageReleased, true);
    let replay = null;
    for (const event of events) {
        replay = applyEvent(replay, event);
        const node = replay.nodes.find(n => n.id === event.node);
        if (event.type === 'node-end' && node.kind === 'test' && event.status === 'passed') {
            assert.equal(node.status, 'running'); assert.equal(node.active, true);
        }
        if (event.type === 'spec-end') assert.equal(node.status, event.status);
    }
});
test('failed final consumer is visible and still releases the checkpoint', async t => {
    const input = setup(t); input.workflow.specs.at(-1).run = async () => { throw new Error('private assertion value'); };
    const events = [], report = await execute({...input, onEvent: e => events.push(e)}), state = events.reduce(applyEvent, null);
    assert.equal(state.status, 'failed'); assert.equal(state.nodes.find(n => n.id === 'coupon-1').status, 'failed');
    assert.equal(state.cleanup.storageReleased, true); assert.ok(report.releases.length > 0);
    assert.equal(JSON.stringify(events).includes('private assertion value'), false);
});
test('retention and failed cleanup do not display checkpoints as released', async t => {
    for (const retain of [true, false]) {
        const input = setup(t), events = [];
        if (!retain) input.provider.cleanup = async () => { throw new Error('cleanup unavailable'); };
        const report = await execute({...input, checkpointLifetime: 'run', retain, onEvent: e => events.push(e)});
        const state = events.reduce(applyEvent, null);
        assert.equal(state.cleanup.storageReleased, false);
        assert.equal(state.nodes.find(n => n.id === 'cart-ready').checkpointState, retain ? 'retained' : 'recovery-required');
        assert.equal(report.status, retain ? 'passed' : 'failed');
    }
});
test('failed observation cannot alter execution or cleanup', async t => {
    const input = setup(t);
    const report = await execute({...input, onEvent: () => { throw new Error('viewer failed'); }});
    assert.equal(report.status, 'passed'); assert.ok(report.observation.error); assert.equal(fs.existsSync(report.directory), false);
    fs.writeFileSync(path.join(input.root, 'not-a-directory'), 'x');
    const failedFile = await execute({...input, provider: new FixtureProvider(), eventDirectory: path.join(input.root, 'not-a-directory')});
    assert.equal(failedFile.status, 'passed'); assert.ok(failedFile.observation.error);
});
test('a stalled observer has a bounded final drain and cannot retain checkpoints', {timeout: 5000}, async t => {
    const report = await execute({...setup(t), onEvent: () => new Promise(() => {})});
    assert.equal(report.status, 'passed'); assert.ok(report.observation.error);
    assert.equal(fs.existsSync(report.directory), false);
});
test('the first selected checkpoint is blue even when its ancestors execute linearly', async t => {
    const events = [], report = await execute({...setup(t), checkpointSelection: ['cart-ready'], onEvent: e => events.push(e)});
    assert.equal(report.status, 'passed');
    const state = events.reduce(applyEvent, null);
    assert.equal(state.nodes.find(n => n.id === 'cart-ready').depth, 1);
    assert.equal(state.nodes.find(n => n.id === 'customer-ready').kind, 'step');
});
test('a large snapshot keeps the event stream open after backpressure drains', async t => {
    const input = setup(t);
    for (const node of [...input.workflow.stages, ...input.workflow.specs]) node.label = node.id + 'x'.repeat(4000);
    await execute(input);
    const app = await startDashboard({directory: input.eventDirectory, port: 0}); t.after(() => app.close());
    const response = await fetch(app.url + '/events'), reader = response.body.getReader(); let text = '';
    while (!text.includes('event: journal') || !text.endsWith('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    const next = reader.read();
    assert.equal(await Promise.race([next.then(value => value.done ? 'closed' : 'data'), delay(120, 'open')]), 'open');
    await reader.cancel(); await next;
});
test('live updates transmit only appended events and reconstruct the same final state in the consumer', async t => {
    const input = setup(t), report = await execute(input);
    const file = path.join(input.eventDirectory, report.run + '.ndjson'), lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    const split = Math.floor(lines.length / 2), prefix = lines.slice(0, split).join('\n') + '\n', suffix = lines.slice(split).join('\n') + '\n';
    fs.writeFileSync(file, prefix);
    const manifest = path.join(input.root, 'manifest.json'); fs.writeFileSync(manifest, '{"preview":"unchanged"}');
    const app = await startDashboard({directory: input.eventDirectory, manifest, port: 0}); t.after(() => app.close());
    const response = await fetch(app.url + '/events'), reader = response.body.getReader(); let buffer = '';
    async function next() {
        while (true) {
            const boundary = buffer.indexOf('\n\n');
            if (boundary < 0) { const chunk = await reader.read(); assert.equal(chunk.done, false); buffer += new TextDecoder().decode(chunk.value); continue; }
            const message = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            if (message.includes('event: journal')) return JSON.parse(message.split('\n').find(line => line.startsWith('data: ')).slice(6));
        }
    }
    const first = await next(); assert.equal(first.reset, true); assert.equal(first.journals[0].content, prefix);
    fs.appendFileSync(file, suffix); await app.scan();
    const delta = await next(); assert.equal(delta.reset, false); assert.equal('manifest' in delta, false);
    assert.deepEqual(delta.journals, [{id: report.run, from: prefix.length, content: suffix}]);
    const state = (first.journals[0].content + delta.journals[0].content).trim().split('\n').map(JSON.parse).reduce(applyEvent, null);
    assert.equal(state.status, report.status); assert.deepEqual(state.counts, report.counts);
    await reader.cancel();
});
test('dashboard serves metadata only and restores a complete snapshot on reconnect', async t => {
    const input = setup(t), app = await startDashboard({directory: input.eventDirectory, port: 0});
    t.after(() => app.close());
    const report = await execute(input); await app.scan();
    assert.equal((await fetch(app.url)).status, 200);
    assert.match((await fetch(app.url)).headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await fetch(app.url + '/engine.cjs')).status, 404);
    assert.equal((await fetch(app.url + '/api/state', {method: 'POST'})).status, 405);
    assert.equal((await fetch(app.url, {headers: {origin: 'http://unrelated.example'}})).status, 403);
    const snapshot = await (await fetch(app.url + '/api/state')).json(); assert.equal(snapshot.runs[0].id, report.run);
    for (let i = 0; i < 2; i++) {
        const response = await fetch(app.url + '/events', {headers: {'Last-Event-ID': '1'}}), reader = response.body.getReader();
        const value = new TextDecoder().decode((await reader.read()).value); await reader.cancel();
        assert.match(value, /event: journal/); assert.match(value, new RegExp(report.run)); assert.match(value, /storageReleased/);
    }
    const file = path.join(input.eventDirectory, report.run + '.ndjson');
    const original = fs.readFileSync(file, 'utf8');
    fs.appendFileSync(file, '{"partial":'); await app.scan(); assert.equal(app.snapshot().runs[0].status, 'passed');
    fs.appendFileSync(file, 'true}\n'); await app.scan(); assert.equal(app.snapshot().warnings.length, 1);
    fs.writeFileSync(file, original); await app.scan(); assert.equal(app.snapshot().warnings.length, 0);
});
