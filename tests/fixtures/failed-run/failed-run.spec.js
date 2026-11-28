// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Disposable spec for tests/e2e-isolated.sh: one test fails after it has executed application code.
const {test, expect} = require('../support.cjs');

test.describe('Failed run', () => {
    test('opens the storefront', async ({page}) => {
        await page.goto('/');
        await expect(page.locator('body')).toBeVisible();
    });
    test('fails after opening the storefront', async ({page}) => {
        await page.goto('/');
        await expect(page.locator('body')).toBeVisible();
        throw new Error('Deliberate failure: the coverage run must still publish its reports.');
    });
});
