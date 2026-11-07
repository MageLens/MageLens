// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('@playwright/test');
const {execute} = require('../../../branching/engine.cjs');
const {LinearCheckout} = require('./linear-warm.cjs');
const {workflow, hostOwner} = require('../branching/checkout-journeys.cjs');
const {assertNoOrders} = require('../branching/checkout-state.cjs');

async function main() {
    const [workspaceArg, rootArg] = process.argv.slice(2);
    const workspace = fs.realpathSync(workspaceArg), root = fs.realpathSync(rootArg);
    assert.ok(root.startsWith(workspace + path.sep), 'Linear artifacts must belong to the independent linear installation');
    assert.ok(!Object.keys(require.cache).some(p => /\/branching\/(provider|storage|browser|browser-context|code-cache)\.cjs$/.test(p)),
        'Linear control must not load P0 runtime features');
    const owner = JSON.parse(fs.readFileSync(path.join(workspace, '.runtime/experience-owner.json')));
    assert.equal(owner.purpose, 'isolated branching experience validation'); assert.equal(owner.arm, 'conventional-linear');
    fs.copyFileSync(path.join(__dirname, '../branching/checkout.php'), path.join(workspace, 'docker/branching-checkout-fixture.php'));
    fs.chmodSync(path.join(workspace, 'docker/branching-checkout-fixture.php'), 0o644);
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    try {
        assert.equal(browser.version(), '156.0.8078.80'); assert.equal(require('@playwright/test/package.json').version, '1.65.0');
        const provider = new LinearCheckout({workspace, browser, baseURL: process.env.PLAYWRIGHT_BASE_URL});
        const baseline = await provider.normalizedState(); assertNoOrders(baseline);
        const fixture = JSON.parse(fs.readFileSync(path.join(workspace, '.runtime/checkout-fixture.json'))), orders = [], evidence = {};
        const graph = workflow(provider, fixture, orders, evidence);
        const report = await execute({workflow: graph, provider, root, approach: 'L0', checkpointLifetime: 'last-consumer'});
        const result = {report, orders, evidence, queueDrains: provider.queueDrains,
            browser: {name: 'Chrome for Testing', version: browser.version(), playwright: require('@playwright/test/package.json').version},
            isolation: {project: provider.project, reset: 'SQL import + ordinary tar',
                contexts: 'new context for every test', customCodeCache: false, cow: false, php: 'retained between tests'},
            operations: provider.operations, events: provider.events,
            cleanup: {lockReleased: !fs.existsSync(path.join(workspace, '.runtime/workflow.lock')),
                recoveryReleased: !fs.existsSync(path.join(workspace, '.runtime/linear-recovery.json')),
                runStorageReleased: !fs.existsSync(report.directory), baselineEqual: false}};
        if (result.cleanup.lockReleased && result.cleanup.recoveryReleased) {
            try { result.cleanup.baselineEqual = JSON.stringify(await provider.normalizedState()) === JSON.stringify(baseline); }
            catch (error) { result.cleanupVerificationError = error.message; }
        }
        const output = path.join(workspace, '.runtime/warm-linear-results'); fs.mkdirSync(output, {recursive: true});
        const file = path.join(output, report.run + '.json');
        fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', {mode: 0o600}); hostOwner(output); hostOwner(file);
        hostOwner(path.join(workspace, '.runtime/checkout-order-reference.json'));
        console.log(JSON.stringify({file, status: report.status, counts: report.counts, metrics: report.metrics,
            cleanup: result.cleanup, errors: report.errors}, null, 2));
        assert.equal(report.status, 'passed'); assert.ok(Object.values(result.cleanup).every(Boolean));
        assert.equal(report.results.length, 9); assert.equal(orders.length, 9);
        assert.equal(report.checkpoints.length, 0); assert.equal(report.counts.reuseHits, 0);
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
