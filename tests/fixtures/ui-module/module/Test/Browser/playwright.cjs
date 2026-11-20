// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {expect} = require('@playwright/test');
const {parent, menu, listingEffects, formEffects, fields, provider, gridHead, columnLabels, rows,
    input, button, responseId, documentResponse, sortingRequest, testValue} = require('./journey.cjs');

async function observe(page, expected, response, record) {
    expect(response).toMatch(responseId);
    const evidence = () => page.evaluate(() => window.__mageLensUiEffects.snapshot());
    await expect.poll(async () => {
        const observed = await evidence();
        return expected.filter(({identity, type}) =>
            observed.some(entry => entry.identity === identity && entry.type === type && entry.response === response));
    }).toEqual(expected);
    for (const effect of expected) record({...effect, response});
    return evidence();
}

async function runUiJourney(page, admin, record) {
    const collect = Boolean(record);
    await admin.navigateAdminMenu(page, parent, menu('listing'));
    const heading = page.locator(gridHead).filter({hasText: 'Untouched column'});
    await expect(heading).toBeVisible();
    await expect(page.locator(gridHead)).toHaveText(columnLabels);
    await expect(page.locator(rows)).toHaveText(['First row', 'Second row']);
    const listingResponse = await page.evaluate(documentResponse);
    if (collect) await observe(page, listingEffects, listingResponse, record);
    else expect(listingResponse).toBeUndefined();

    for (const direction of ['asc', 'desc']) {
        const reload = page.waitForResponse(response => response.request().method() === 'GET' && sortingRequest(response.url()) === direction);
        await heading.click();
        const response = await reload;
        expect(response.status()).toBe(200);
        await expect(page.locator(rows)).toHaveText(direction === 'asc' ? ['First row', 'Second row'] : ['Second row', 'First row']);
        const reloadResponse = await response.headerValue('x-magelens-response');
        if (collect && direction === 'desc') {
            await observe(page, [{type: 'ui-reloaded', identity: provider}], reloadResponse, record);
            expect(reloadResponse).not.toEqual(listingResponse);
        } else if (!collect) expect(reloadResponse).toBeNull();
    }

    await admin.navigateAdminMenu(page, parent, menu('form'));
    await expect(page.locator(input)).toBeVisible();
    await expect(page.locator(button('uninvoked'))).toBeVisible();
    await expect(page.locator(button('uninstantiated'))).toHaveCount(0);
    const formResponse = await page.evaluate(documentResponse);
    if (collect) {
        await observe(page, formEffects.filter(effect => effect.type !== 'ui-action-invoked'), formResponse, record);
    } else expect(formResponse).toBeUndefined();
    const untouched = page.locator(input);
    const initial = await untouched.inputValue();
    await untouched.fill(testValue);
    await expect(untouched).toHaveValue(testValue);
    await page.locator(button('invoke')).click();
    await expect(untouched).toHaveValue(initial);
    if (collect) {
        const observed = await observe(page, [{identity: fields + 'invoke', type: 'ui-action-invoked'}], formResponse, record);
        expect(observed.filter(entry => entry.identity === fields + 'uninstantiated' ||
            (entry.identity === fields + 'uninvoked' && entry.type === 'ui-action-invoked'))).toEqual([]);
    }
}

module.exports = {runUiJourney};
