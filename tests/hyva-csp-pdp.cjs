// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {chromium, expect} = require('@playwright/test');
const {disablePageTransitions} = require('../bin/browser-navigation.cjs');

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
const product = 'Push It Messenger Bag';

for (const headless of [true, false]) {
    test(`Hyvä CSP sample PDP in ${headless ? 'headless' : 'headed'} Chrome`, {timeout: 120_000}, async t => {
        const browser = await chromium.launch({channel: 'chrome', headless});
        t.after(() => browser.close());
        t.diagnostic(`Chrome for Testing ${browser.version()}`);

        // Third-party suites can open instrumented storefront pages in a stock context.
        const context = await browser.newContext({baseURL, ignoreHTTPSErrors: true});
        await context.addInitScript(disablePageTransitions);
        await context.addInitScript(() => {
            document.addEventListener('alpine:initialized', () => { window.alpineInitialized = true; }, {once: true});
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20_000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        t.after(() => assert.equal(errors.length, 0, `Uncaught page errors: ${errors.slice(0, 3).join('; ')}`));
        const response = await page.goto('/push-it-messenger-bag.html');
        assert.equal(response.status(), 200);
        assert.match(response.headers()['content-security-policy'], /(?:^|;)\s*script-src\s/);
        assert.match(await response.text(), / x-mtc="/, 'Expected template instrumentation on the sample storefront');
        await page.waitForFunction(() => window.alpineInitialized);
        await expect(page.getByRole('heading', {name: product, exact: true})).toBeVisible();
        assert.equal(errors.length, 0, `PDP initialization errors: ${errors.slice(0, 3).join('; ')}`);

        const accountButton = page.getByRole('button', {name: 'My Account'});
        await accountButton.click();
        await expect(page.getByRole('navigation', {name: 'My Account'}).getByRole('link', {name: 'Sign In'})).toBeVisible();
        await accountButton.click();

        await page.locator('#add-to-compare').click();
        await expect(page.locator('#messages')).toContainText(`You added product ${product} to the comparison list.`, {timeout: 20_000});
        await expect(page.locator('#compare-link')).toBeVisible();

        await page.locator('#product-addtocart-button').click();
        await expect(page.locator('#messages')).toContainText(`You added ${product} to your shopping cart.`, {timeout: 20_000});
        const drawer = page.locator('#cart-drawer');
        if (!await drawer.isVisible()) await page.locator('#menu-cart-icon').click();
        await expect(drawer.getByText(product, {exact: true})).toBeVisible();
        await page.goto('/checkout/cart/');
        await expect(page.getByRole('main').getByRole('link', {name: product, exact: true}).filter({hasText: product})).toBeVisible();
    });
}
