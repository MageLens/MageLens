// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {test, expect} = require('@playwright/test');
const {installPlaywrightAdminDependencies, disablePageTransitions} = require('../../../bin/browser-navigation.cjs');
const admin = require('../../../src/app/code/Application/Blog/Test/Playwright/support');
const {runUiJourney} = require('./module/Test/Browser/playwright.cjs');
const pinnedChrome = /^CHROME_VERSION: "([^"]+)"$/m.exec(fs.readFileSync('dependencies.yaml', 'utf8'))[1];

test('renders and interacts with standalone UI XML through native Magento', async ({browser, context, page}) => {
    expect(browser.version()).toBe(pinnedChrome);
    expect(fs.existsSync('coverage/.active-run')).toBe(false);
    const checkDependencies = await installPlaywrightAdminDependencies(context);
    await context.addInitScript(disablePageTransitions);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await admin.login(page);
    await runUiJourney(page, admin);
    checkDependencies();
    expect(errors).toEqual([]);
});
