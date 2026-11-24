// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {chromium, expect} = require('@playwright/test');
const {trackBrowserErrors} = require('./browser-errors.cjs');

test('instrumented Hyvä CSP fixture works in a fresh context without an observer', async t => {
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    t.after(() => browser.close());
    t.diagnostic(`Chrome for Testing ${browser.version()}`);
    const context = await browser.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL,
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();
    const assertNoErrors = trackBrowserErrors(page);
    const response = await page.goto('/coverageprobe/');
    assert.equal(response.status(), 200);
    assert.match(response.headers()['content-security-policy'], /(?:^|;)\s*script-src\s/);
    assert.match(await response.text(), /<button(?=[^>]*\bx-mtc=")(?=[^>]*\bdata-cy="probe-increment")[^>]*>/,
        'Expected the served increment button to carry a template coverage marker');
    assert.equal(await page.evaluate(() => typeof window.__mtcTemplateHit), 'undefined');

    const count = page.locator('[data-cy="probe-count"]');
    await expect(count).toHaveText('0');
    await page.locator('[data-cy="probe-increment"]').click();
    await expect(count).toHaveText('1');
    assertNoErrors();

    const unrelated = 'Unrelated application warning';
    await Promise.all([
        page.waitForEvent('console', {predicate: message => message.text() === unrelated}),
        page.evaluate(warning => console.warn(warning), unrelated)
    ]);
    assertNoErrors();

    await Promise.all([
        page.waitForEvent('console', {predicate: message => message.type() === 'warning'
            && message.text().includes('missingMageLensProbeProperty'), timeout: 5000}),
        page.locator('[data-cy="probe"]').evaluate(probe => {
            const output = document.createElement('output');
            output.setAttribute('x-text', 'missingMageLensProbeProperty');
            probe.append(output);
        })
    ]);
    assert.throws(assertNoErrors, /Alpine Error:[\s\S]*missingMageLensProbeProperty/);

    const uncaught = 'MageLens uncaught error control';
    await Promise.all([
        page.waitForEvent('pageerror', {predicate: error => error.message === uncaught, timeout: 5000}),
        page.evaluate(message => { setTimeout(() => { throw new Error(message); }, 0); }, uncaught)
    ]);
    assert.throws(assertNoErrors, /MageLens uncaught error control/);

    // Boot the same Alpine build on a small page to provoke its native
    // plugin and expression warnings without loading storefront plugins.
    const alpine = await page.locator('script[src*="/alpine3-csp"]').getAttribute('src');
    const warnings = await context.newPage();
    const assertNoWarnings = trackBrowserErrors(warnings);
    const control = '/coverageprobe/alpine-warning-control';
    await warnings.route(url => url.pathname === control, route => route.fulfill({
        contentType: 'text/html',
        headers: {'content-security-policy': "script-src 'self' 'nonce-magelens-warning'"},
        body: `<!doctype html>
            <script defer src="${alpine}"></script>
            <script nonce="magelens-warning">
                document.addEventListener('alpine:init', () => {
                    Alpine.data('warningControl', () => ({
                        fail() { throw new Error('MageLens expression error control'); }
                    }));
                });
            </script>
            <div x-data="warningControl" x-sort>
                <button x-on:click="fail">Throw from a directive</button>
            </div>`
    }));
    const missingPlugin = /Alpine Warning:.*missing sort plugin/;
    await Promise.all([
        warnings.waitForEvent('console', {predicate: message => missingPlugin.test(message.text()), timeout: 5000}),
        warnings.goto(control)
    ]);
    assert.throws(assertNoWarnings, missingPlugin);

    const expressionError = /Alpine Expression Error: MageLens expression error control/;
    await Promise.all([
        warnings.waitForEvent('console', {predicate: message => expressionError.test(message.text()), timeout: 5000}),
        warnings.getByRole('button').click()
    ]);
    assert.throws(assertNoWarnings, expressionError);
});
