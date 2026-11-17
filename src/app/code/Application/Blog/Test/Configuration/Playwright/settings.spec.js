// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test, expect, fixtures, headers, login, navigateAdminMenu} = require('./support');
const {journeys} = require('../Configuration/journeys.cjs');

test('uses inherited journal settings and shows the selected Admin fields', async ({page}) => {
    expect(fixtures().configuration, 'isolated settings fixture ownership').toBeTruthy();
    for (const suffix of ['', '-warm']) for (const [name, expected] of journeys) {
        const response = await page.request.get('/blog/index/configuration?case=' + name + suffix, {headers: headers()});
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject(expected);
        if (name === 'value-reads') expect(body.multiline).toContain('First line\nSecond line');
        if (body.heading) for (const key of ['numeric', 'object', 'current']) if (key in body) expect(body[key]).toBe(body.heading);
    }
    await login(page);
    await navigateAdminMenu(page, '#menu-magento-backend-stores > a', '[data-ui-id="menu-magento-config-system-config"] > a');
    await page.getByRole('link', {name: 'Journal settings', exact: true}).click();
    const toggleDisplayGroup = async () => {
        const saved = page.waitForResponse(response => response.request().method() === 'POST'
            && response.url().includes('/system_config/state/'));
        await page.locator('#application_blog_display-head').click();
        expect((await saved).status()).toBe(200);
    };
    if (await page.locator('#application_blog_display-state').inputValue() === '0') {
        await toggleDisplayGroup();
    }
    await expect(page.locator('#application_blog_display-state')).toHaveValue('1');
    await expect(page.locator('#application_blog_display_heading')).toBeVisible();
    await expect(page.locator('#application_blog_display_heading')).toHaveValue('Journal');
    for (const name of ['alias_one', 'alias_two']) {
        await expect(page.locator('#application_blog_display_' + name)).toBeVisible();
        await expect(page.locator('#application_blog_display_' + name)).toHaveValue('Read more from our journal');
    }
    await expect(page.locator('#application_blog_display_hidden')).toHaveCount(0);
    await expect(page.locator('#application_blog_editorial_unused_unused')).toHaveCount(0);
    await toggleDisplayGroup();
    await expect(page.locator('#application_blog_display-state')).toHaveValue('0');
    await expect(page.locator('#application_blog_display_heading')).toBeHidden();
    await toggleDisplayGroup();
    await expect(page.locator('#application_blog_display-state')).toHaveValue('1');
    await expect(page.locator('#application_blog_display_heading')).toBeVisible();
    const adminResponse = await page.reload();
    expect(await adminResponse.headerValue('x-magelens-admin-argument')).toBe('admin label');
    expect(await adminResponse.headerValue('x-magelens-admin-preference')).toBe('resolved');
    expect(await adminResponse.headerValue('x-magelens-admin-observer')).toBe('executed');
    expect(await adminResponse.headerValue('x-magelens-admin-plugin')).toBe('short:startbbbb|after|after');
    await expect(page.locator('#application_blog_display_heading')).toBeVisible();
    await expect(page.locator('#application_blog_display_heading')).toHaveValue('Journal');
});
