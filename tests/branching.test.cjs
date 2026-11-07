// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Graph, execute, CheckpointStore, cleanup, digest} = require('../branching/engine.cjs');
const {FixtureProvider, fixtureWorkflow} = require('./fixtures/branching/provider.cjs');

function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-branch-test-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    return {root, workflow: fixtureWorkflow(), provider: new FixtureProvider()};
}
test('recursive reuse executes each Stage once and matches every fresh terminal state', async t => {
    const input = setup(t), fresh = await execute({...input, approach: 'L0'}), branch = await execute({...input, provider: new FixtureProvider(), approach: 'branching'});
    assert.equal(fresh.status, 'passed'); assert.equal(branch.status, 'passed');
    assert.equal(fresh.counts.prefixExecutions, 11); assert.equal(branch.counts.prefixExecutions, 4);
    assert.deepEqual(branch.results.map(r => r.state), fresh.results.map(r => r.state));
    assert.equal(branch.checkpoints.length, 4);
    assert.equal(branch.checkpoints.at(-1).parent, branch.checkpoints[2].id);
    assert.ok(branch.results[2].inheritedSegments.length > 0);
    const cartHitSegments = branch.segments.filter(s => s.coverage.hits.includes('cart'));
    assert.equal(cartHitSegments.length, 4, 'suffix hits shared with parent must not be subtracted');
    assert.equal(new Set(branch.segments.map(s => s.id)).size, 7);
    assert.deepEqual(fs.readdirSync(input.root), []);
});
test('an individual Spec resolves only its required chain', async t => {
    const result = await execute({...setup(t), approach: 'branching', specs: ['coupon-1']});
    assert.equal(result.status, 'passed'); assert.equal(result.results.length, 1);
    assert.equal(result.counts.prefixExecutions, 4);
});
test('reject cycles, missing edges, multi-parent nodes, duplicate IDs and empty selections', () => {
    let w = fixtureWorkflow(); w.stages[0].parent = 'cart-ready'; assert.throws(() => new Graph(w), /cycle/);
    w = fixtureWorkflow(); w.specs[0].parent = 'absent'; assert.throws(() => new Graph(w), /Missing/);
    w = fixtureWorkflow(); w.stages[0].parent = ['customer-ready']; assert.throws(() => new Graph(w), /one Stage/);
    w = fixtureWorkflow(); w.specs[0].parent = null; assert.throws(() => new Graph(w), /exactly one/);
    w = fixtureWorkflow(); w.specs[0].id = 'baseline'; assert.throws(() => new Graph(w), /duplicate/);
    assert.throws(() => new Graph(fixtureWorkflow()).select([]), /Empty/);
    assert.throws(() => new Graph(fixtureWorkflow()).select(['absent']), /Unknown/);
});
test('all compatibility inputs and ancestor implementations affect descendants', () => {
    const original = new Graph(fixtureWorkflow()).key('shipping-selected');
    for (const field of ['source', 'fixture', 'configuration', 'dependencies', 'implementation']) {
        const w = fixtureWorkflow(); w.identity[field] = 'changed';
        assert.notEqual(new Graph(w).key('shipping-selected'), original);
    }
    const w = fixtureWorkflow(); w.stages[0].run = async () => {};
    assert.notEqual(new Graph(w).key('shipping-selected'), original);
    const inputs = fixtureWorkflow(); inputs.stages[1].inputs.work = 1;
    assert.notEqual(new Graph(inputs).key('shipping-selected'), original);
});
test('library accepts the validated Graph used by the CLI before backend setup', async () => {
    const {runBranches} = require('../playwright/branching.cjs');
    for (const workflow of [fixtureWorkflow(), new Graph(fixtureWorkflow())]) {
        await assert.rejects(runBranches({workflow, backend: {}, state: async () => ({})}), /Missing backend lifecycle: prepare/);
    }
});
test('failed parent blocks all descendants without executing Specs', async t => {
    const input = setup(t); input.workflow.stages[1].assert = async () => { throw new Error('customer failed'); };
    const result = await execute({...input, approach: 'branching'});
    assert.equal(result.status, 'failed'); assert.equal(result.results.length, 3);
    assert.equal(result.counts.failures, 1); assert.equal(result.counts.blockedSpecs, 3);
    assert.ok(result.results.every(r => r.status === 'blocked' && r.blockedBy === 'customer-ready'));
    assert.equal(result.segments.filter(s => s.kind === 'Spec').length, 0);
});
test('corrupted checkpoint falls back to the last compatible ancestor', async t => {
    let corrupted = false;
    const result = await execute({...setup(t), approach: 'branching', fault: async (phase, {ref, stage}) => {
        if (phase === 'beforeRestore' && stage === 'cart-ready' && !corrupted) {
            fs.writeFileSync(path.join(ref.directory, 'payload/state.json'), '{}'); corrupted = true;
        }
    }});
    assert.equal(result.status, 'failed'); assert.equal(result.qualification, 'inconclusive');
    assert.equal(result.counts.fallbacks, 1); assert.equal(result.counts.prefixExecutions, 5);
    assert.match(result.errors[0].message, /Corrupted/);
});
test('interrupted capture stays unpublished and replay starts from clean state', async t => {
    const input = setup(t);
    const result = await execute({...input, approach: 'branching', fault: async phase => {
        if (phase === 'captured') throw new Error('injected interruption');
    }});
    assert.equal(result.status, 'failed'); assert.equal(result.checkpoints.length, 0);
    assert.equal(result.qualification, 'inconclusive'); assert.ok(result.counts.fallbacks > 0);
    assert.deepEqual(fs.readdirSync(input.root), []);
});
test('incomplete, expired, incompatible and foreign checkpoints are rejected', async t => {
    const input = setup(t), result = await execute({...input, approach: 'branching', retain: true});
    const m = result.checkpoints[0], directory = path.join(result.directory, m.id);
    const ref = {directory, digest: digest(m)};
    const store = new CheckpointStore(result.directory, result.run, m.profile);
    assert.equal(store.verify(ref, m.key).id, m.id);
    assert.throws(() => store.verify(ref, 'wrong'), /incompatible/);
    assert.throws(() => store.verify(ref, m.key, m.expiresAt), /expired/);
    assert.throws(() => new CheckpointStore(result.directory, 'other', m.profile).verify(ref, m.key), /incompatible/);
    const future = {...m, schemaVersion: 2};
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(future));
    assert.throws(() => store.verify({...ref, digest: digest(future)}, m.key), /incompatible/);
    fs.unlinkSync(path.join(directory, 'manifest.json'));
    assert.throws(() => store.verify(ref, m.key), /ENOENT/);
    assert.throws(() => cleanup(result.directory, 'other'), /Unowned/);
    cleanup(result.directory, result.run);
});
test('barrier rejects open transactions, in-flight work and queues', async () => {
    for (const field of ['inFlight', 'transaction', 'queue']) {
        const p = new FixtureProvider(); p[field] = true;
        await assert.rejects(p.barrier(), /Unquiesced/);
    }
});
test('failed cleanup never yields a successful run', async t => {
    const input = setup(t); input.provider.cleanup = async () => { throw new Error('cleanup failed'); };
    const result = await execute(input); assert.equal(result.status, 'failed');
    assert.equal(result.errors.at(-1).phase, 'cleanup');
});
test('a restore failure cannot leak partial state into a continuation', async t => {
    const input = setup(t); const original = input.provider.restore.bind(input.provider); let restores = 0;
    input.provider.restore = async dir => {
        if (++restores === 4) { input.provider.state = {broken: true}; throw new Error('interrupted restore'); }
        await original(dir);
    };
    const result = await execute({...input, approach: 'branching'});
    assert.equal(result.status, 'failed'); assert.ok(result.counts.fallbacks > 0);
});
test('semantic session expiry rejects reuse and replays authentication', async t => {
    const input = setup(t); let now = 0, delayed = false;
    const login = input.workflow.stages[1].run;
    input.workflow.stages[1].run = async p => { await login(p); p.state.browser.expiresAt = now + 100; };
    const customerCheck = input.workflow.stages[1].assert;
    input.workflow.stages[1].assert = async p => { await customerCheck(p); assert.ok(p.state.browser.expiresAt > now, 'session expired'); };
    const check = input.workflow.stages[2].assert;
    input.workflow.stages[2].assert = async p => {
        await check(p); assert.ok(p.state.browser.expiresAt > now, 'session expired');
    };
    const result = await execute({...input, approach: 'branching', fault: async (phase, data) => {
        if (phase === 'beforeRestore' && data.stage === 'cart-ready' && !delayed) { now = 200; delayed = true; }
    }});
    assert.equal(result.status, 'failed'); assert.ok(result.counts.fallbacks > 0);
    assert.ok(result.errors.some(error => error.message.includes('session expired')));
});
test('100 recursive contract trials preserve parent and sibling state', async t => {
    const input = setup(t);
    for (let i = 0; i < 100; i++) {
        const result = await execute({...input, provider: new FixtureProvider(), approach: 'branching'});
        assert.equal(result.status, 'passed'); assert.equal(result.errors.length, 0);
        assert.equal(result.counts.prefixExecutions, 4);
    }
});

test('a failed reset fails its scenario while later scenarios still run and cleanup completes', async t => {
    const input = setup(t), reset = input.provider.reset.bind(input.provider);
    let resets = 0;
    input.provider.reset = async () => {
        if (resets++ === 0) throw new Error('reset rejected before the first test');
        return reset();
    };
    const report = await execute({...input, approach: 'L0'});
    assert.equal(report.status, 'failed');
    assert.equal(report.results.length, input.workflow.specs.length);
    assert.equal(report.results[0].status, 'failed');
    assert.ok(report.results.slice(1).every(result => result.status === 'passed'));
    assert.deepEqual(fs.readdirSync(input.root), []);
});
