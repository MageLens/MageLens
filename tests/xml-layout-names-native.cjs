// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path = require('node:path');
const {chromium, expect} = require('@playwright/test');
const {disablePageTransitions} = require(path.resolve('bin/browser-navigation.cjs'));
(async () => {
    const browser = await chromium.launch({channel: 'chrome', headless: false});
    try {
        const context = await browser.newContext({ignoreHTTPSErrors: true});
        await context.addInitScript(disablePageTransitions);
        const errors = [];
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        for (const fixtureCase of ['blocks', 'move', 'containers']) {
            const url = new URL('/coverageprobe/names/', process.env.PLAYWRIGHT_BASE_URL || process.env.CYPRESS_BASE_URL);
            url.searchParams.set('case', fixtureCase);
            const response = await page.goto(url.href);
            expect(response.status(), `Native names HTTP case ${fixtureCase}`).toBe(200);
            await expect(page.locator('[data-layout-name-proof]')).toHaveText('verified');
            await expect(page.locator('[data-layout-name-stale-roots]')).toHaveAttribute('data-layout-name-stale-roots', '0');
            await expect(page.locator('[data-layout-name-case]')).toHaveCount(fixtureCase === 'containers' ? 1 : (fixtureCase === 'move' ? 5 : 4));
            if (fixtureCase !== 'containers') {
                await expect(page.locator('#layout-numeric-root')).toHaveCount(0);
                await expect(page.locator('[data-layout-name-render-failed]')).toHaveText('verified');
                await expect(page.locator('[data-layout-name-case="integer"]')).toHaveText('override');
                await expect(page.locator('#layout-numeric-root [data-layout-name-case="integer"]')).toHaveCount(0);
                if (fixtureCase === 'move') await expect(page.locator('[data-layout-name-case="moved"]')).toHaveText('base');
                else await expect(page.locator('[data-layout-name-case="moved"]')).toHaveCount(0);
                for (const name of ['leading', 'zero', 'anonymous']) {
                    await expect(page.locator(`[data-layout-name-case="${name}"]`)).toHaveText('base');
                }
            } else await expect(page.locator('#layout-zero-container [data-layout-name-case="container-child"]')).toHaveText('base');
        }
        expect(errors).toEqual([]);
        expect((await context.cookies()).some(cookie => cookie.name === 'application_coverage')).toBe(false);
        console.log(JSON.stringify({status: 'passed', browser: 'chrome-for-testing', version: browser.version(),
            nativeCases: ['blocks', 'move', 'containers'], collection: false}));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
