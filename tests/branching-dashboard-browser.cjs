// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium, expect} = require('@playwright/test');
const {selfCoverage} = require('./branching-self-coverage.cjs');
const {rustCoverage} = require('./branching-rust-coverage.cjs');
const {assets} = require('../branching/configs/dashboard-assets.cjs');

async function main() {
    const output = path.resolve(process.argv[2] ?? '.runtime/branching-dashboard-self-test'); fs.mkdirSync(output, {recursive: true});
    const coverage = selfCoverage(path.join(output, 'coverage'));
    const nativeCoverage = rustCoverage(path.join(output, 'rust-coverage'));
    const {execute, Graph} = require('./fixtures/branching/engine.cjs');
    const autoExecute = require('../branching/engine.cjs').execute;
    const {planner} = require('../branching/planner-client.cjs');
    const {buildWorkflow} = require('../branching/automatic.cjs');
    const {startDashboard} = require('../branching/dashboard/server.cjs');
    const {FixtureProvider, fixtureWorkflow} = require('./fixtures/branching/provider.cjs');
    const {deepWorkflow} = require('./fixtures/branching/deep-workflow.cjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-dashboard-browser-'));
    const directory = path.join(root, 'events'), manifestPath = path.join(root, 'manifest.json');
    const assetDirectory = path.join(root, 'assets'); fs.mkdirSync(assetDirectory);
    for (const [file] of Object.values(assets)) fs.copyFileSync(path.join(__dirname, '../branching/dashboard', file), path.join(assetDirectory, file));
    const app = await startDashboard({directory, manifest: manifestPath, assetDirectory, port: 0, pollMs: 30,
        transformAsset: (file, source) => coverage.transformAsset(path.join(__dirname, '../branching/dashboard', path.basename(file)), source)});
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    const context = await browser.newContext({viewport: {width: 1600, height: 1050}}), page = await context.newPage();
    const errors = [], checks = []; let running, failure;
    const releases = [];
    page.on('pageerror', error => errors.push(error.message));
    const checked = label => { checks.push(label); console.log('PASS', label); };
    const block = id => page.locator(`.node[data-node="${id}"]`);
    const base = {root: path.join(root, 'storage'), eventDirectory: directory, checkpointLifetime: 'last-consumer'};
    async function select(report) { await expect(page.locator(`#run-select option[value="${report.run}"]`)).toHaveCount(1); await page.locator('#run-select').selectOption(report.run); }
    try {
        assert.equal(browser.version(), '156.0.8078.80'); assert.equal(require('@playwright/test/package.json').version, '1.65.0');
        await page.goto(app.url); await expect(page.getByText('Your execution map will appear here')).toBeVisible();
        checked('empty dashboard connects without requiring a Magento installation');

        const workflow = fixtureWorkflow(), login = Promise.withResolvers(), last = Promise.withResolvers(); releases.push(login.resolve, last.resolve);
        const startLogin = workflow.stages[1].run; workflow.stages[1].run = async (...args) => { await login.promise; return startLogin(...args); };
        const endTest = workflow.specs.at(-1).run; workflow.specs.at(-1).run = async (...args) => { await last.promise; return endTest(...args); };
        workflow.stages[0].label = 'Start customer'; workflow.stages[1].label = 'Authenticated customer';
        workflow.stages[2].label = 'Cart ready'; workflow.stages[3].label = 'Shipping selected';
        running = execute({...base, workflow, provider: new FixtureProvider()});
        await expect(block('customer-ready')).toHaveAttribute('data-active', 'true');
        await expect(page.locator('[data-test="remove-item"]')).toHaveAttribute('data-status', 'running');
        assert.equal(await page.locator('[data-test="remove-item"] progress').evaluate(el => el.value), 1);
        assert.equal(await page.locator('[data-test="coupon-1"] progress').evaluate(el => el.value), 0);
        await expect(block('baseline')).toHaveAttribute('data-depth', 'first');
        await expect(block('cart-ready')).toHaveAttribute('data-depth', 'follow');
        await expect(block('coupon-1')).toHaveAttribute('data-kind', 'test');
        assert.equal(await block('baseline').evaluate(el => getComputedStyle(el).borderLeftColor), 'rgb(45, 103, 203)');
        assert.equal(await block('cart-ready').evaluate(el => getComputedStyle(el).borderLeftColor), 'rgb(27, 136, 102)');
        assert.equal(await block('coupon-1').evaluate(el => getComputedStyle(el).borderLeftColor), 'rgb(198, 75, 89)');
        const pulse = block('customer-ready').locator('.working-dot'), initialOpacity = await pulse.evaluate(el => getComputedStyle(el).opacity);
        await expect.poll(() => pulse.evaluate(el => getComputedStyle(el).opacity)).not.toBe(initialOpacity);
        await block('cart-ready').hover(); await expect(page.getByRole('tooltip')).toBeVisible();
        await expect(page.locator('#detail-kind')).toHaveText('checkpoint details');
        await block('cart-ready').click(); await expect(page.locator('#detail-title')).toHaveText('Cart ready');
        await expect(page.locator('#details')).toContainText('coupon-1');
        await page.screenshot({path: path.join(output, 'graph-active.png'), fullPage: true});
        checked('real engine graph has depth colors, dependency edges, active pulse and selectable details');
        assert.ok(await block('cart-ready').evaluate(el => el.offsetTop > document.querySelector('[data-node="customer-ready"]').offsetTop));
        assert.ok(await block('coupon-1').evaluate(el => el.offsetTop > document.querySelector('[data-node="cart-ready"]').offsetTop));
        checked('graph flows from the first checkpoint at the top to terminal tests below');
        login.resolve(); await expect(block('coupon-1')).toHaveAttribute('data-active', 'true');
        await expect(block('cart-ready')).toHaveAttribute('data-last', 'true');
        await expect(block('shipping-selected')).toContainText('Last consumer · cleanup next');
        assert.equal(await page.locator('[data-test="coupon-1"] progress').evaluate(el => el.value), 4);
        await expect(page.locator('[data-test="remove-item"] .test-outcome')).toHaveText('✓ Passed');
        checked('checkpoint remains available until the last selected consumer');

        await context.setOffline(true); last.resolve(); const report = await running; running = null;
        assert.equal(report.status, 'passed'); assert.equal(fs.existsSync(report.directory), false);
        await context.setOffline(false);
        await expect(page.locator('#run-status')).toHaveText('passed');
        await expect(page.locator('#cleanup-summary')).toHaveText('Cleanup complete');
        await expect(block('cart-ready')).toHaveAttribute('data-checkpoint', 'released');
        await expect(page.locator('#metric-reuses')).toHaveText(String(report.counts.reuseHits));
        await expect(page.locator('.node[data-active="true"]')).toHaveCount(0);
        await expect(page.locator('.test-cell[data-status="passed"]')).toHaveCount(3);
        assert.equal(await block('coupon-1').locator('.node-status').evaluate(el => getComputedStyle(el).color), 'rgb(22, 128, 75)');
        assert.equal(await page.locator('[data-test="coupon-1"] .test-outcome').evaluate(el => getComputedStyle(el).fontWeight), '800');
        await page.screenshot({path: path.join(output, 'graph-complete.png'), fullPage: true});
        checked('reconnect receives missed completion and actual cleanup without replaying a test');
        await coverage.browser(page); await page.reload(); await expect(block('cart-ready')).toHaveAttribute('data-checkpoint', 'released');
        await expect(page.locator('#detail-title')).toHaveText('Cart ready'); checked('refresh preserves the selected run and block');
        checked('hover details and linear test progress reflect executed and restored setup with bold green outcomes');

        const bad = fixtureWorkflow(); bad.specs.at(-1).run = async () => { throw new Error('intentional test failure'); };
        const failed = await execute({...base, workflow: bad, provider: new FixtureProvider()}); await select(failed);
        await expect(block('coupon-1')).toHaveAttribute('data-status', 'failed'); await expect(block('cart-ready')).toHaveAttribute('data-checkpoint', 'released');
        await expect(page.locator('[data-test="coupon-1"] .test-outcome')).toHaveText('✕ Failed');
        assert.equal(await block('coupon-1').locator('.node-status').evaluate(el => getComputedStyle(el).color), 'rgb(190, 48, 71)');
        assert.equal(await page.locator('[data-test="coupon-1"] .test-outcome').evaluate(el => getComputedStyle(el).fontWeight), '800');
        checked('a failed last test is visible while its checkpoint is still cleaned');
        const parent = fixtureWorkflow(); parent.stages[1].run = async () => { throw new Error('intentional parent failure'); };
        const blocked = await execute({...base, workflow: parent, provider: new FixtureProvider()}); await select(blocked);
        await expect(page.locator('.node[data-kind="test"][data-status="blocked"]')).toHaveCount(3);
        checked('parent failure blocks descendants and never shows them as successful');
        const provider = new FixtureProvider(); provider.cleanup = async () => { throw new Error('intentional cleanup failure'); };
        const recovery = await execute({...base, workflow: fixtureWorkflow(), checkpointLifetime: 'run', provider}); await select(recovery);
        await expect(block('cart-ready')).toHaveAttribute('data-checkpoint', 'recovery-required'); await expect(page.locator('#cleanup-summary')).toHaveText('Recovery required');
        checked('failed cleanup preserves recovery state instead of claiming release');
        const retained = await execute({...base, workflow: fixtureWorkflow(), provider: new FixtureProvider(), retain: true}); await select(retained);
        await expect(block('cart-ready')).toHaveAttribute('data-checkpoint', 'retained'); checked('retained checkpoints remain visibly retained');

        await select(report);
        const newer = await execute({...base, workflow: fixtureWorkflow(), provider: new FixtureProvider()});
        await expect(page.locator(`#run-select option[value="${newer.run}"]`)).toHaveCount(1);
        await expect(page.locator('body')).toHaveAttribute('data-run', report.run);
        await page.locator('#latest-run').click(); await expect(page.locator('body')).toHaveAttribute('data-run', newer.run);
        await coverage.browser(page); await page.reload();
        const newest = await execute({...base, workflow: fixtureWorkflow(), provider: new FixtureProvider()});
        await expect(page.locator('body')).toHaveAttribute('data-run', newest.run);
        await expect(page.locator('#latest-run')).toHaveAttribute('aria-pressed', 'true');
        checked('new runs appear automatically after reload while explicit history selection remains available');

        const deep = deepWorkflow(), top = Promise.withResolvers(), bottom = Promise.withResolvers(), terminal = Promise.withResolvers();
        releases.push(top.resolve, bottom.resolve, terminal.resolve);
        for (const [node, gate] of [[deep.stages[0], top], [deep.stages[10], bottom], [deep.specs.at(-1), terminal]]) {
            const original = node.run; node.run = async p => { await gate.promise; return original(p); };
        }
        let deepRun;
        running = execute({...base, workflow: deep, provider: new FixtureProvider(), onEvent: e => { deepRun ??= e.run; }});
        await expect.poll(() => deepRun).toBeTruthy(); await select({run: deepRun});
        await expect(block('stage-00')).toHaveAttribute('data-active', 'true');
        await expect(page.locator('#warnings')).toContainText('at most 9');
        await expect(page.locator('.node[data-kind="checkpoint"]')).toHaveCount(9);
        const activeInside = () => page.evaluate(() => {
            const viewport = document.getElementById('viewport').getBoundingClientRect();
            const node = document.querySelector('.node[data-active="true"]').getBoundingClientRect();
            return node.top >= viewport.top && node.bottom <= viewport.bottom && node.left >= viewport.left && node.right <= viewport.right;
        });
        top.resolve(); await expect(block('stage-10')).toHaveAttribute('data-active', 'true');
        await expect.poll(activeInside).toBe(true);
        assert.ok(await page.locator('#viewport').evaluate(el => el.scrollTop > 0 && el.scrollLeft > 0));
        await page.screenshot({path: path.join(output, 'graph-follow.png'), fullPage: true});
        await page.locator('#follow-active').click(); await expect(page.locator('#follow-active')).toHaveAttribute('aria-pressed', 'false');
        await page.locator('#viewport').evaluate(el => el.scrollTo({top: 0, left: 0, behavior: 'instant'}));
        bottom.resolve(); await expect(block('test-11-1')).toHaveAttribute('data-active', 'true');
        assert.equal(await page.locator('#viewport').evaluate(el => el.scrollTop), 0);
        await page.emulateMedia({reducedMotion: 'reduce'}); await page.locator('#follow-active').click();
        await expect.poll(activeInside).toBe(true);
        await expect(block('test-11-1').locator('.working-dot')).toHaveCSS('opacity', '1');
        terminal.resolve(); const deepReport = await running; running = null;
        assert.equal(deepReport.status, 'passed'); assert.equal(deepReport.checkpoints.length, 9);
        assert.equal(deepReport.releases.length, 9); await expect(page.locator('#cleanup-summary')).toHaveText('Cleanup complete');
        await page.emulateMedia({reducedMotion: 'no-preference'});
        checked('nine-checkpoint limit warns, follows the active pulse in both axes, pauses and resumes, and cleans every selected checkpoint');

        planner(['plan', path.join(__dirname, 'fixtures/dashboard-source'), manifestPath]);
        planner(['verify', manifestPath]); await app.scan();
        const manifest = JSON.parse(fs.readFileSync(manifestPath)); assert.equal(manifest.tests.length, 3); assert.ok(manifest.checkpoints.length >= 2);
        assert.ok(manifest.checkpoints.every(cp => cp.label === 'After page.goto()'));
        await page.locator('#plan-button').click(); await expect(page.locator('#run-status')).toHaveText('planned');
        await expect(page.locator('.node[data-kind="test"]')).toHaveCount(3);
        await expect(page.locator('.node[data-kind="checkpoint"]')).toHaveCount(manifest.checkpoints.length);
        await expect(page.locator('.node[data-kind="checkpoint"]').first()).toContainText('After page.goto()');
        checked('real Rust source manifest renders repeated prefixes and all terminal tests');
        class AutomaticProvider extends FixtureProvider {
            get page() { return {goto: async url => { this.hit(url); this.state.browser.url = url; }}; }
        }
        const built = buildWorkflow(manifest, {identity: 'dashboard-fixture', state: p => p.normalizedState(), assertCheckpoint: async p => assert.ok(p.state.browser.url.startsWith('/'))});
        const automatic = await execute({...base, ...built, provider: new AutomaticProvider()}); await select(automatic);
        await expect(page.locator('#run-status')).toHaveText('passed'); assert.ok(automatic.counts.reuseHits > 0);
        checked('Rust-derived graph executes through the real engine and reports checkpoint reuse');
        const decision = {report: await autoExecute({...base, ...built, provider: new AutomaticProvider()})};
        assert.equal(decision.report.approach, 'L0'); await select(decision.report);
        await expect(page.locator('.node[data-kind="checkpoint"]')).toHaveCount(0);
        await expect(page.locator('#metric-reuses')).toHaveText('0'); checked('static Rust cost decision shows tiny repeated prefixes as linear execution');

        const large = new Graph(deepWorkflow());
        const boundedReport = await autoExecute({...base, workflow: large, provider: new FixtureProvider()});
        const bounded = {report: boundedReport, decision: boundedReport.checkpointPolicy};
        assert.equal(bounded.decision.maxCheckpointsPerTest, 9); assert.equal(bounded.decision.selected.length, 9);
        assert.equal(bounded.report.status, 'passed'); await select(bounded.report);
        await expect(page.locator('.node[data-kind="checkpoint"]')).toHaveCount(9);
        await expect(page.locator('#warnings')).toContainText('at most 9');
        assert.ok(bounded.decision.decisions.some(item => item.reason === 'checkpoint-limit'));
        checked('native Rust cost selection caps each path at nine and executes the constrained plan');

        const groups = ['simple', 'configurable', 'bundle'], grouped = fixtureWorkflow();
        grouped.stages = groups.map(id => ({id, run: async p => p.hit(id), assert: async p => assert.deepEqual(p.state.db.cart, [])})).reverse();
        grouped.specs = groups.flatMap(parent => ['paid', 'discount', 'free'].map(name => ({id: `${parent}-${name}`, parent,
            run: async p => p.hit(name), assert: async p => assert.deepEqual(p.state.db.cart, [])})));
        const sequential = await execute({...base, workflow: grouped, provider: new FixtureProvider()}); await select(sequential);
        for (let i = 1; i < groups.length; i++) {
            const nextTop = await block(groups[i]).evaluate(el => el.offsetTop);
            const priorBottom = await block(`${groups[i - 1]}-free`).evaluate(el => el.offsetTop + el.offsetHeight);
            assert.ok(nextTop > priorBottom);
        }
        assert.deepEqual(await page.locator('.test-cell').evaluateAll(els => els.map(el => el.dataset.test)), grouped.specs.map(s => s.id));
        await page.screenshot({path: path.join(output, 'graph-sequence.png'), fullPage: true});
        checked('independent groups stack vertically in actual execution order, mirrored by the linear test list');

        await coverage.browser(page);
        const document = path.join(assetDirectory, 'index.html');
        fs.writeFileSync(document, fs.readFileSync(document, 'utf8').replace('MageLens · Branching explorer</title>', 'MageLens · Updated dashboard</title>'));
        await expect(page).toHaveTitle('MageLens · Updated dashboard');
        await expect(page.locator('#run-status')).toHaveText('passed');
        assert.ok(page.url().includes(sequential.run));
        checked('a dashboard file change reloads the browser automatically and preserves the selected execution');

        await block('simple').click();
        await coverage.browser(page);
        const moduleFile = path.join(assetDirectory, 'graph-node.mjs');
        const reloaded = page.waitForEvent('load');
        fs.appendFileSync(moduleFile, '\n// Exercise reload detection for an imported module.\n');
        await reloaded;
        await expect(page.locator('body')).toHaveAttribute('data-run', sequential.run);
        await expect(page.locator('#detail-title')).toHaveText('simple');
        checked('an imported module change reloads the dashboard and restores run and node selection');

        const unsafe = fixtureWorkflow(); unsafe.stages[0].label = '<img src=x onerror=alert(1)>';
        const escaped = await execute({...base, workflow: unsafe, provider: new FixtureProvider()}); await select(escaped);
        await expect(block('baseline')).toContainText('<img src=x onerror=alert(1)>'); assert.equal(await page.locator('.node img').count(), 0);
        await block('cart-ready').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#detail-title')).toHaveText('cart-ready');
        await page.getByRole('button', {name: 'Zoom in', exact: true}).click(); await page.getByRole('button', {name: 'Zoom out', exact: true}).click(); await page.getByRole('button', {name: 'Fit', exact: true}).click();
        await page.emulateMedia({reducedMotion: 'reduce'});
        await page.setViewportSize({width: 390, height: 844});
        await expect(page.locator('#run-select')).toBeVisible();
        await expect(page.locator('#connection')).toHaveClass('connected');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await expect.poll(() => block('baseline').evaluate(el => {
            const node = el.getBoundingClientRect(), viewport = document.getElementById('viewport').getBoundingClientRect();
            return node.left >= viewport.left && node.right <= viewport.right;
        })).toBe(true);
        await page.screenshot({path: path.join(output, 'graph-mobile.png'), fullPage: true});
        checked('labels stay inert, keyboard selection works, and the mobile layout avoids page overflow');
        assert.deepEqual(errors, []); checked('no uncaught browser errors');
    } catch (error) { failure = error; await page.screenshot({path: path.join(output, 'failure.png'), fullPage: true}).catch(() => {}); }
    finally {
        for (const release of releases) release();
        if (running) await running.catch(() => {});
        await coverage.browser(page); await context.close(); await browser.close(); await app.close();
        // Failed contract cleanup is intentional above; only this owned temp root is removed.
        fs.rmSync(root, {recursive: true, force: true});
        let rust = null;
        try { rust = nativeCoverage?.finish() ?? null; } catch (error) { failure ??= error; }
        coverage.finish({status: failure ? 'failed' : 'passed', checks, nativeRustCoverage: rust ? 'rust-coverage/summary.json' : null,
            browser: 'Chrome for Testing 156.0.8078.80', playwright: '1.65.0',
            ...(failure ? {error: failure.message} : {})});
    }
    if (failure) throw failure;
    console.log(`Dashboard self-tests passed: ${checks.length}. Coverage: ${path.join(output, 'coverage/index.html')}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
