// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {expect} = require('@playwright/test');
const {parent, menu, gridHead, columnLabels, rows, input, readOnly, button, initialValue, readOnlyValue,
    proofDirectory, responseId, documentResponse, uiRequest, testValue,
    initialDisabled, replacementButton, registerReplacement} = require('./journey.cjs');

function waitForUiResponse(page, purpose) {
    return page.waitForResponse(response => response.request().method() === 'GET' && uiRequest(response.url()) === purpose);
}

async function responseIdFor(pending, collect) {
    const response = await pending;
    expect(response.status()).toBe(200);
    const id = await response.headerValue('x-magelens-response');
    if (collect) expect(id).toMatch(responseId);
    else expect(id).toBeNull();
    return id;
}

async function pageResponse(page, collect) {
    const id = await page.evaluate(documentResponse);
    if (collect) expect(id).toMatch(responseId);
    else expect(id).toBeUndefined();
    return id;
}

function saveResponses(name, responses) {
    fs.mkdirSync(proofDirectory, {recursive: true});
    fs.writeFileSync(`${proofDirectory}/${name}.json`, JSON.stringify(responses));
}

async function runUiJourney(page, admin, collect = false) {
    const initial = waitForUiResponse(page, 'initial');
    await admin.navigateAdminMenu(page, parent, menu('listing'));
    const heading = page.locator(gridHead).filter({hasText: 'Untouched column'});
    await expect(heading).toBeVisible();
    await expect(page.locator(gridHead)).toHaveText(columnLabels);
    await expect(page.locator(rows)).toHaveText(['First row', 'Second row']);
    const grid = {navigation: await pageResponse(page, collect), initial: await responseIdFor(initial, collect)};
    for (const direction of ['asc', 'desc']) {
        const reload = waitForUiResponse(page, direction);
        await heading.click();
        grid[direction] = await responseIdFor(reload, collect);
        await expect(page.locator(rows)).toHaveText(direction === 'asc' ? ['First row', 'Second row'] : ['Second row', 'First row']);
    }
    if (collect) saveResponses('grid', grid);

    const inserted = waitForUiResponse(page, 'form');
    await admin.navigateAdminMenu(page, parent, menu('form'));
    const form = {navigation: await pageResponse(page, collect), delivery: await responseIdFor(inserted, collect)};
    const untouched = page.locator(input);
    await expect(untouched).toBeVisible();
    await expect(untouched).toHaveValue(initialValue);
    await expect(page.locator(readOnly)).toBeVisible();
    await expect(page.locator(readOnly)).toHaveText(readOnlyValue);
    await expect(page.locator(button('uninvoked'))).toBeVisible();
    await expect(page.locator(button('uninstantiated'))).toHaveCount(0);
    await page.evaluate(registerReplacement, initialDisabled);
    const replacement = page.locator(replacementButton);
    await replacement.click();
    await expect(replacement).toHaveAttribute('data-invoked', 'true');
    await untouched.fill(testValue);
    await expect(untouched).toHaveValue(testValue);
    await page.locator(button('invoke')).click();
    await expect(untouched).toHaveValue(initialValue);
    if (collect) saveResponses('form', form);
}

module.exports = {runUiJourney};
