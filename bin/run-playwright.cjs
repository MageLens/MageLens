// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {chromium} = require('@playwright/test');
const {warmupPaths, specPatterns} = require('./project.cjs');
const {disablePageTransitions} = require('./browser-navigation.cjs');

async function main() {
    if (process.argv.includes('--warmup')) {
        const browser = await chromium.launch({channel: 'chrome', headless: false});
        try {
            const page = await browser.newPage({ignoreHTTPSErrors: true});
            await page.context().addInitScript(disablePageTransitions);
            await require('@vitaliiboiko/magento-template-coverage/playwright').installTemplateRuntime(page.context());
            const paths = warmupPaths(JSON.parse(fs.readFileSync('coverage/project-fixtures.json')));
            const baseUrl = process.env.PLAYWRIGHT_BASE_URL || process.env.CYPRESS_BASE_URL;
            for (const path of paths) {
                const response = await page.goto(new URL(path, baseUrl).href, {timeout: 180000});
                if (!response?.ok()) throw new Error(`Warm-up ${path} HTTP ${response?.status()}`);
                await page.waitForLoadState('networkidle', {timeout: 180000});
            }
            fs.writeFileSync('coverage/warmup-results.json', JSON.stringify({runner: 'playwright', status: 'passed',
                browser: {name: 'chrome-for-testing', version: browser.version()}}));
        } finally { await browser.close(); }
        return;
    }
    const prediction = require('../branching/predictor/session.cjs').start(fs.globSync(specPatterns('playwright')).sort(), 'playwright');
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config=playwright.config.cjs'], {stdio: 'inherit'});
    const completed = fs.existsSync('coverage/playwright-results.json') ? JSON.parse(fs.readFileSync('coverage/playwright-results.json')) : null;
    prediction.finish({passed:result.status === 0 && completed?.status === 'passed' && completed.totalTests > 0 &&
        completed.totalPassed === completed.totalTests && !completed.totalFailed && !completed.totalSkipped && !completed.totalPending,
        attempts:completed?.maxAttempts ?? 1});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Playwright failed. Inspect coverage/playwright-results.json and coverage/playwright-artifacts.');
    const tests = JSON.parse(fs.readFileSync('coverage/playwright-results.json'));
    if (tests.status !== 'passed' || !tests.totalTests || tests.totalPassed !== tests.totalTests || tests.totalFailed || tests.totalSkipped || tests.totalPending) {
        throw new Error('The full Playwright suite did not pass.');
    }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
