// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium, expect} = require('@playwright/test');
const {startDashboard} = require('../branching/dashboard/server.cjs');
const {journey, schedule, withDiscoveredGraph} = require('./fixtures/branching/dashboard-adaptive.cjs');
const pinned = require('./dependency-pins.cjs');

// Exercise the real HTTP/SSE transport, reducer and DOM, without a manifest file.
// These deterministic journals specify UI behavior; producer parity is tested
// separately against the real engine in branching-dashboard-adaptive.test.cjs.
async function acceptance(page, checked = () => {}, output) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-adaptive-browser-'));
    const app = await startDashboard({directory: root, port: 0, pollMs: 30});
    const errors = [], failures = [];
    const onError = error => errors.push(error.message);
    page.on('pageerror', onError);
    const block = () => page.locator('.node[data-node="prefix"]');
    async function publish(events) {
        fs.writeFileSync(path.join(root, events[0].run + '.ndjson'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
        await app.scan();
    }
    const cases = [
        ['discovered', async () => {
            await expect(block()).toHaveAttribute('data-checkpoint', 'candidate');
            await expect(page.locator('#metric-tests')).toHaveText('0 / 5');
            await expect(page.locator('#graph-summary')).toContainText('1 overlapping prefixes excluded');
        }],
        ['calibrating', async () => {
            await expect(page.locator('#run-status')).toHaveText('calibrating');
            await expect(page.getByRole('region', {name: 'Checkpoint costs'})).toContainText(/incompatible/i);
            await expect(page.getByRole('region', {name: 'Checkpoint costs'})).toContainText(/runtime.resources/i);
            await expect(page.locator('#metric-reuses')).toHaveText('0');
        }],
        ['measuring', async () => {
            await expect(block()).toHaveAttribute('data-checkpoint', 'measuring');
            await expect(block()).toContainText(/measuring/i);
            await expect(page.locator('#metric-checkpoints')).toHaveText('0 / 1');
            await expect(page.locator('#metric-reuses')).toHaveText('0');
        }],
        ['linear', async () => {
            await expect(block()).toHaveAttribute('data-checkpoint', 'linear');
            await block().click();
            await expect(page.locator('#details')).toContainText(/measured prefix/i);
            await expect(page.locator('#details')).toContainText(/remaining consumers/i);
            await expect(page.locator('#details')).toContainText(/avoided work/i);
            await expect(page.locator('#details')).toContainText(/checkpoint cost/i);
            await expect(page.locator('#activity')).toContainText(/linear/i);
            await expect(page.locator('#metric-cleaned')).toHaveText('0');
        }],
        ['capturing', async () => {
            await expect(block()).toHaveAttribute('data-checkpoint', 'capturing');
            await expect(page.locator('#metric-checkpoints')).toHaveText('0 / 1');
            await expect(page.locator('#metric-reuses')).toHaveText('0');
        }],
        ['restoring', async () => {
            await expect(block()).toHaveAttribute('data-active', 'true');
            await expect(block()).toContainText(/restoring/i);
            await expect(page.locator('#metric-reuses')).toHaveText('0');
            await expect(page.locator('.test-cell[data-test="b"]')).not.toHaveAttribute('data-status', 'passed');
        }],
        ['abandoning', async () => {
            await expect(block()).toHaveAttribute('data-checkpoint', 'abandoning');
            await expect(page.locator('#metric-cleaned')).toHaveText('0');
            await expect(page.getByRole('region', {name: 'Checkpoint costs'})).toContainText(/restore/i);
            await expect(page.locator('#activity')).toContainText(/recalibrat/i);
        }],
        ['finished', async () => {
            await expect(block()).toHaveAttribute('data-checkpoint', 'released');
            await expect(block()).toContainText(/uneconomic|abandoned/i);
            await expect(page.locator('#metric-tests')).toHaveText('5 / 5');
            await expect(page.locator('#metric-reuses')).toHaveText('1');
            await expect(page.locator('#metric-cleaned')).toHaveText('1');
            await block().click();
            await expect(page.locator('#details')).toContainText(/sunk/i);
            await expect(page.locator('#subtitle')).toContainText('4.0 s');
            await expect(page.locator('main')).not.toContainText(/\d+(?:\.\d+)?% saved/i);
            await page.reload();
            await expect(page.locator('#detail-title')).toHaveText('Catalog prefix');
            await expect(page.locator('#details')).toContainText(/sunk/i);
        }],
        ['failed', async () => {
            await expect(page.locator('#run-status')).toHaveText('failed');
            await expect(page.locator('#cleanup-summary')).toHaveText('Cleanup complete');
            await expect(page.locator('#metric-reuses')).toHaveText('0');
            await block().click();
            await expect(page.locator('#details')).toContainText(/restore/i);
            await expect(block()).not.toContainText(/uneconomic|abandoned/i);
        }]
    ];
    try {
        for (const [kind, check] of cases) {
            try {
                const events = kind === 'discovered' ? journey(kind) : withDiscoveredGraph(journey(kind));
                await page.goto(app.url + '/#run=' + events[0].run + '&history=1');
                await publish(events.slice(0, 2));
                await expect(page.locator(`#run-select option[value="${events[0].run}"]`)).toHaveCount(1);
                await page.locator('#run-select').selectOption(events[0].run);
                await expect(page.locator('#run-status')).toHaveText('discovering', {timeout: 2000});
                if (kind === 'discovered') await expect(page.locator('.node')).toHaveCount(0);
                await publish(events);
                await expect(page.locator('.node[data-kind="test"]')).toHaveCount(5, {timeout: 2000});
                assert.deepEqual(await page.locator('.test-cell').evaluateAll(els => els.map(el => el.dataset.test)), schedule);
                await expect(page.locator('.node[data-node="ancestor"]')).toHaveCount(0);
                await check();
                assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Adaptive details must not overflow the page');
                if (output && kind === 'finished') await page.screenshot({path:path.join(output,'adaptive-finished.png'),fullPage:true});
                checked('adaptive dashboard: ' + kind);
            } catch (error) { failures.push(new Error(kind + ': ' + error.message)); }
        }
        assert.deepEqual(errors, [], 'No application errors may be suppressed');
        if (failures.length) throw new AggregateError(failures, `${failures.length} adaptive dashboard acceptance cases failed`);
    } finally {
        page.off('pageerror', onError);
        await app.close();
        fs.rmSync(root, {recursive: true, force: true});
    }
}
module.exports = {acceptance};
if (require.main === module) (async () => {
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    try {
        assert.equal(browser.version(), pinned('CHROME_VERSION'));
        assert.equal(require('@playwright/test/package.json').version, pinned('PLAYWRIGHT_VERSION'));
        await acceptance(await browser.newPage(), message => console.log('PASS', message));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
