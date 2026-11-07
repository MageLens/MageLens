// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Explicit, destructive-fixture check on an owned disposable installation only.
// This adapts checkout journeys to public Hyva CSP + Magento's bundled checkout;
// it does not represent the commercial Hyva Checkout suites.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('@playwright/test');
const {MagentoBackend} = require('../branching/magento.cjs');
const {P0Provider} = require('../branching/provider.cjs');
const {execute, Graph, fileDigest} = require('../branching/engine.cjs');
const {orchestrate} = require('../branching/costs.cjs');
const {probe} = require('../branching/storage.cjs');
const {assertNoOrders, CONSUMERS} = require('./fixtures/branching/checkout-state.cjs');
const {workflow, hostOwner} = require('./fixtures/branching/checkout-journeys.cjs');

class CheckoutBackend extends MagentoBackend {
    constructor(options) { super(options); this.queueDrains = []; }
    php(action, data) {
        const running = this.inspect('phpfpm').State.Running;
        const args = running ? ['exec', '-T', 'phpfpm'] : ['run', '--rm', '--no-deps', 'phpfpm'];
        return JSON.parse(this.dc([...args, 'php', '/application/docker/branching-checkout-fixture.php', action,
            ...(data === undefined ? [] : [JSON.stringify(data)])]));
    }
    async drainQueues() {
        for (let round = 0; round < 8; round++) {
            const pending = this.php('queues');
            if (!pending.length) return;
            for (const queue of pending) {
                assert.equal(queue.status, 2, 'Queue in progress, retry or error needs investigation');
                assert.ok(CONSUMERS.has(queue.name), 'Unqualified checkout queue: ' + queue.name);
                assert.ok(Number.isSafeInteger(queue.count) && queue.count > 0 && queue.count < 10000);
                const prefix = this.inspect('phpfpm').State.Running ? ['exec', '-T', 'phpfpm'] : ['run', '--rm', '--no-deps', 'phpfpm'];
                this.dc([...prefix, 'php', 'bin/magento', 'queue:consumers:start', queue.name, '--max-messages=' + queue.count]);
                this.queueDrains.push({...queue});
            }
        }
        throw new Error('Checkout queue drain did not converge');
    }
    async drain() {
        await super.drain();
        if (this.inspect('db').State.Running) await this.drainQueues();
    }
}

async function main() {
    const [workspaceArg, rootArg, mode = 'P0', ...specs] = process.argv.slice(2);
    const workspace = fs.realpathSync(workspaceArg), root = fs.realpathSync(rootArg);
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.runtime/experience-owner.json'))).purpose, 'isolated branching experience validation');
    assert.ok(!fs.existsSync(path.join(workspace, '.runtime/workflow.lock')) &&
        !fs.existsSync(path.join(workspace, '.runtime/branching-recovery.json')), 'Finish or recover the active workflow first');
    probe(root);
    const backend = new CheckoutBackend({workspace, helperImage: process.env.MAGELENS_P0_IMAGE, disposable: true});
    const fixtureFile = path.join(workspace, 'docker/branching-checkout-fixture.php');
    fs.copyFileSync(path.join(__dirname, 'fixtures/branching/checkout.php'), fixtureFile); fs.chmodSync(fixtureFile, 0o644);
    const metadata = path.join(workspace, '.runtime/checkout-fixture.json');
    if (mode === 'prepare') {
        assert.ok(!fs.existsSync(metadata), 'Do not overwrite an initialized fixture');
        backend.php('preflight'); await backend.drainQueues();
        const fixture = backend.php('prepare'); await backend.drainQueues();
        backend.dc(['exec', '-T', 'phpfpm', 'php', 'bin/magento', 'indexer:reindex']);
        backend.dc(['exec', '-T', 'phpfpm', 'php', 'bin/magento', 'cache:flush']);
        assertNoOrders(backend.php('state'));
        fs.writeFileSync(metadata, JSON.stringify(fixture) + '\n', {mode: 0o600});
        hostOwner(metadata);
        console.log('Prepared checkout fixture'); return;
    }
    assert.ok(['L0', 'P0', 'AUTO'].includes(mode));
    const fixture = JSON.parse(fs.readFileSync(metadata)), orders = [], evidence = {};
    const baseline = backend.php('state'); assertNoOrders(baseline);
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    try {
        assert.equal(browser.version(), '156.0.8078.80'); assert.equal(require('@playwright/test/package.json').version, '1.65.0');
        const provider = new P0Provider({browser, backend, baseURL: process.env.PLAYWRIGHT_BASE_URL,
            contextOptions: {ignoreHTTPSErrors: true}, state: async () => backend.php('state'), measureActions: true});
        const fullGraph = workflow(backend, fixture, orders, evidence);
        const graph = specs.length ? new Graph({identity: fullGraph.identity,
            stages: [...fullGraph.stages.values()], specs: fullGraph.select(specs)}) : fullGraph;
        const result = await orchestrate({mode, workflow: graph, run: (approach, policy = {}) => execute({
            workflow: graph, provider, root, approach, checkpointLifetime: 'last-consumer', ...policy,
            ...(specs.length ? {specs} : {})
        })});
        result.orders = orders; result.evidence = evidence; result.queueDrains = backend.queueDrains;
        result.browser = {name: 'Chrome for Testing', version: browser.version(), playwright: require('@playwright/test/package.json').version};
        result.cleanup = {lockReleased: !fs.existsSync(path.join(workspace, '.runtime/workflow.lock')),
            recoveryReleased: !fs.existsSync(path.join(workspace, '.runtime/branching-recovery.json')),
            runStorageReleased: !fs.existsSync(result.report.directory),
            baselineEqual: false};
        if (result.cleanup.lockReleased && result.cleanup.recoveryReleased) {
            try { result.cleanup.baselineEqual = JSON.stringify(backend.php('state')) === JSON.stringify(baseline); }
            catch (error) { result.cleanupVerificationError = error.message; }
        }
        const output = path.join(workspace, '.runtime/checkout-results'); fs.mkdirSync(output, {recursive: true});
        const file = path.join(output, result.report.run + '.json');
        fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', {mode: 0o600});
        hostOwner(output); hostOwner(file);
        const ledger = path.join(workspace, '.runtime/checkout-order-reference.json');
        if (fs.existsSync(ledger)) hostOwner(ledger);
        console.log(JSON.stringify({file, status: result.report.status, counts: result.report.counts, metrics: result.report.metrics,
            cleanup: result.cleanup, errors: result.report.errors}, null, 2));
        assert.equal(result.report.status, 'passed');
        assert.ok(Object.values(result.cleanup).every(Boolean), 'Original installation was not fully recovered');
        assert.deepEqual(result.report.releases.map(r => r.stage), result.report.checkpoints.map(c => c.stage));
        for (const release of result.report.releases) {
            assert.equal(release.after, graph.select().filter(s => graph.chain(s.parent).some(n => n.id === release.stage)).at(-1).id);
        }
    } finally { await browser.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {CheckoutBackend, workflow};
