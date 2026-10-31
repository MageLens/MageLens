// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {verifyScriptPolicy} = require('../csp-proof');
const {test, expect} = require('../../../../../../../.runtime/elgentos/support.cjs');
test('collects real PHP, JavaScript and template execution', async ({page, externalFixture}) => {
    expect(externalFixture).toBe('elgentos-guest');
    const response = await page.goto('/coverageprobe/');
    if (process.env.MAGELENS_THEME === 'hyva') {
        const policy = response.headers()['content-security-policy'];
        expect(policy).toContain('script-src');
        expect(policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1]).not.toContain("'unsafe-eval'");
        expect(policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1]).not.toContain("'unsafe-inline'");
        const proof = await page.evaluate('(' + verifyScriptPolicy.toString() + ')(document)');
        expect(proof).toEqual({evalBlocked: true, inlineBlocked: true, inlineExecuted: false});
        require('node:fs').writeFileSync('coverage/csp-proof.json', JSON.stringify({theme: 'Hyva/default-csp', runner: 'playwright', ...proof}));
    }
    await expect(page.locator('[data-cy="inline-probe"]')).toHaveText('inline-ready');
    expect(await page.evaluate(() => window.magelensChildScript)).toBe('child-ready');
    await expect(page.locator('[data-cy="probe-count"]')).toHaveText('0');
    await page.locator('[data-cy="probe-increment"]').click();
    await expect(page.locator('[data-cy="probe-count"]')).toHaveText('1');
    await page.getByRole('textbox', {name: 'Probe name'}).fill('coverage');
    await expect(page.locator('[data-cy="probe-echo"]')).toHaveText('coverage');
    await page.locator('[data-cy="probe-save"]').click();
    await expect(page.locator('[data-cy="probe-saved"]')).toHaveText('Saved coverage');
    await expect(page.locator('[data-cy="probe-item"]')).toHaveCount(2);
    await expect(page.locator('[data-cy="probe-never"]')).toHaveCount(0);
    if (process.env.MAGELENS_THEME === 'hyva') {
        expect(await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent('update-gallery-42', {detail: 'gallery-updated'}));
            window.dispatchEvent(new CustomEvent('update-prices-42', {detail: 'price-updated'}));
            const event = new Event('submit', {bubbles: true, cancelable: true});
            document.querySelector('[data-cy="probe-prevented"]').dispatchEvent(event);
            return event.defaultPrevented;
        })).toBe(true);
        await expect(page.locator('[data-cy="probe-image"]')).toHaveText('gallery-updated');
        await expect(page.locator('[data-cy="probe-price"]')).toHaveText('price-updated');
    }
    await page.goto('/customer/account/login/');
    await expect(page.locator('#email')).toBeVisible();
});
test('starts the next test with fresh state', async ({page}) => {
    await page.goto('/coverageprobe/');
    await expect(page.locator('[data-cy="inline-probe"]')).toHaveText('inline-ready');
    expect(await page.evaluate(() => window.magelensChildScript)).toBe('child-ready');
    await expect(page.locator('[data-cy="probe-count"]')).toHaveText('0');
    await expect(page.getByRole('textbox', {name: 'Probe name'})).toHaveValue('initial');
});
