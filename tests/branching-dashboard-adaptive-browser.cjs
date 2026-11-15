// Copyright (c)  MageLens
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
    const edge = (id) => page.locator(`#edges [data-from="prefix"][data-to="${id}"]`);
    async function publish(events) {
        fs.writeFileSync(path.join(root, events[0].run + '.ndjson'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
        await app.scan();
    }
    const cases = [
        ['discovered', async () => {
            await expect(page.locator('#preparation')).toBeVisible();
            await expect(page.locator('#workspace')).toBeHidden();
            await expect(page.locator('.node:visible')).toHaveCount(0);
        }],
        ['bootstrap', async () => {
            await expect(page.locator('#preparation-status')).toHaveText('Preparing execution.');
            await expect(page.locator('#workspace')).toBeHidden();
            await expect(page.locator('.node:visible')).toHaveCount(0);
        }],
        ['measuring', async () => {
            await expect(block()).toHaveCount(0);
            await expect(page.locator('#edges path')).toHaveCount(0);
            await expect(page.locator('.node[data-node="a"]')).toHaveAttribute('data-active', 'true');
            const positions = await page.locator('.node[data-kind="test"]').evaluateAll(items =>
                items.map(node => [node.offsetLeft,node.offsetTop]));
            assert.equal(new Set(positions.map(p => p[0])).size, 1);
            assert.ok(positions.every((p,index) => index === 0 || p[1] > positions[index - 1][1]));
            await expect(page.locator('#metric-checkpoints')).toHaveText('0 / 0');
        }],
        ['linear', async () => {
            await expect(block()).toHaveCount(0);
            await expect(page.locator('#edges path')).toHaveCount(0);
            await expect(page.locator('#activity')).toContainText(/linear/i);
            await expect(page.locator('#metric-cleaned')).toHaveText('0');
        }],
        ['capturing', async () => {
            await expect(block()).toHaveCount(0);
            await expect(page.locator('#metric-checkpoints')).toHaveText('0 / 0');
            await expect(page.locator('#metric-reuses')).toHaveText('0');
        }],
        ['restoring', async () => {
            await expect(block()).toHaveAttribute('data-active', 'true');
            await expect(block()).toContainText(/restoring/i);
            await expect(edge('a')).toHaveCount(1);
            await expect(edge('b')).toHaveCount(1);
            await expect(edge('c')).toHaveCount(0);
            await expect(page.locator('#metric-reuses')).toHaveText('0');
            await expect(page.locator('.test-cell[data-test="b"]')).not.toHaveAttribute('data-status', 'passed');
        }],
        ['abandoning', async () => {
            await expect(block()).toHaveAttribute('data-checkpoint', 'abandoning');
            await expect(page.locator('#metric-cleaned')).toHaveText('0');
            await expect(page.getByRole('region', {name: 'Checkpoint costs'})).toBeHidden();
            await page.locator('#run-details > summary').click();
            await expect(page.getByRole('region', {name: 'Checkpoint costs'})).toContainText(/restore/i);
            await expect(page.locator('#baseline-values')).toContainText('average 1500.0 ms from 1 sample');
            await expect(page.locator('#activity')).toContainText(/recalibrat/i);
        }],
        ['finished', async () => {
            await expect(block()).toHaveAttribute('data-checkpoint', 'released');
            await expect(block()).toContainText(/uneconomic|abandoned/i);
            await expect(edge('a')).toHaveCount(1);
            await expect(edge('b')).toHaveCount(1);
            await expect(edge('c')).toHaveCount(0);
            await expect(page.locator('.test-cell[data-test="b"]')).toContainText('checkpoint restored');
            await expect(block().locator('.node-kind')).toHaveText('Shared prefix');
            await expect(page.locator('.node[data-node="a"] .node-kind')).toHaveText('Specific case');
            await expect(page.locator('.node[data-node="b"] .node-kind')).toHaveText('Specific case');
            await expect(page.locator('.node[data-node="c"] .node-kind')).toHaveText('Test');
            const siblings = await page.locator('.node:is([data-node="a"],[data-node="b"])').evaluateAll(items =>
                items.map(node => [node.offsetLeft,node.offsetTop]));
            assert.equal(siblings[0][1], siblings[1][1]);
            assert.notEqual(siblings[0][0], siblings[1][0]);
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
                await publish(events.slice(0, 2));
                await page.goto('about:blank');
                await page.goto(app.url + '/#run=' + events[0].run + '&history=1');
                await expect(page.locator('#preparation-status')).toHaveText('Discovering tests.', {timeout: 2000});
                await expect(page.locator('#workspace')).toBeHidden();
                await publish(events);
                if (!['discovered','bootstrap'].includes(kind)) {
                    await expect(page.locator('#workspace')).toBeVisible();
                    await expect(page.locator('.node[data-kind="test"]')).toHaveCount(5, {timeout: 2000});
                    assert.deepEqual(await page.locator('.test-cell').evaluateAll(els => els.map(el => el.dataset.test)), schedule);
                }
                await expect(page.locator('.node[data-node="ancestor"]')).toHaveCount(0);
                await check();
                assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Adaptive details must not overflow the page');
                if (output && kind === 'finished') await page.screenshot({path:path.join(output,'adaptive-finished.png'),fullPage:true});
                checked('adaptive dashboard: ' + kind);
            } catch (error) { failures.push(new Error(kind + ': ' + error.message)); }
        }
        // A complete large suite remains hidden through preparation, regardless
        // of how much observation history was produced before readiness.
        const run=require('node:crypto').randomUUID(), large=[];
        const add=(type,data={})=>large.push({schemaVersion:1,run,sequence:large.length+1,time:1700000000000+large.length,type,...data});
        const tests=Array.from({length:600},(_,i)=>({id:`test-${i}`,label:`Test ${i}`,kind:'test',parent:null,consumers:[],releasePolicy:'none'}));
        add('run-start',{approach:'AUTO suite',nodes:[],schedule:[]});
        add('discovery-complete',{nodes:tests,schedule:tests.map(t=>t.id),ordering:{changed:false}});
        for(let i=0;i<6000;i++)add('run-phase',{phase:'preparing',diagnostic:'x'.repeat(600)});
        assert.ok(Buffer.byteLength(large.map(e=>JSON.stringify(e)).join('\n'))>4*1024*1024);
        await publish(large);
        await page.goto('about:blank');
                await page.goto(app.url+'/#run='+run+'&history=1');
        await expect(page.locator('#preparation-status')).toHaveText('Preparing execution.');
        await expect(page.locator('#workspace')).toBeHidden();
        await expect(page.locator('#preparation-warning')).toBeHidden();
        await expect(page.locator('#preparation-progress')).not.toHaveAttribute('value');
        checked('large suite stays in preparation until execution is ready');
        add('run-ready'); add('spec-start',{node:'test-0'});
        await publish(large);
        await expect(page.locator('#workspace')).toBeVisible();
        await expect(page.locator('.test-cell')).toHaveCount(600);
        await expect(page.locator('.node[data-node="test-0"]')).toHaveCSS('border-left-color','rgb(128, 84, 184)');
        await expect(page.locator('#suite-progress')).toHaveAttribute('max','600');
        await expect(page.locator('#suite-progress')).toHaveAttribute('value','0');
        await expect(page.locator('.legend .violet')).toHaveCSS('background-color','rgb(128, 84, 184)');
        for(const test of tests)add('spec-end',{node:test.id,status:test.id==='test-599'?'failed':'passed'});
        add('cleanup-end',{storageReleased:true,retained:false,failed:false});
        add('run-end',{status:'failed',counts:{failures:1}});
        await publish(large);
        await expect(page.locator('.node[data-node="test-599"] .node-status')).toHaveCSS('color','rgb(190, 48, 71)');
        await expect(page.locator('.test-cell[data-status="passed"]')).toHaveCount(599);
        await expect(page.locator('#suite-progress')).toHaveAttribute('value','600');
        await page.reload();
        await expect(page.locator('.test-cell')).toHaveCount(600);
        await expect(page.locator('#run-status')).toHaveText('failed');
        await expect(page.locator('#warnings')).toBeHidden();
        checked('large journal reconnect preserves every outcome and separates violet tests from red failures');
        const failedPreparation=journey('bootstrap');
        failedPreparation.push({schemaVersion:1,run:failedPreparation[0].run,sequence:failedPreparation.length+1,
            time:1700000001000,type:'run-end',status:'failed',counts:{failures:1}});
        await publish(failedPreparation);
        await page.goto('about:blank');
        await page.goto(app.url+'/#run='+failedPreparation[0].run+'&history=1');
        await expect(page.locator('#preparation-status')).toHaveText('Preparation failed. The suite has not started.');
        await expect(page.locator('#workspace')).toBeHidden();
        checked('failed preparation does not expose an execution dashboard');
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
