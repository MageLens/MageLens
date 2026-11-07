// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {test} from '@playwright/test';
test('Check payment', async ({page}) => {
    await page.goto('/customer');
    await page.goto('/cart');
    await page.goto('/shipping');
    await page.goto('/check-order');
});
test('Free order', async ({page}) => {
    await page.goto('/customer');
    await page.goto('/cart');
    await page.goto('/shipping');
    await page.goto('/free-order');
});
test('Edit address', async ({page}) => {
    await page.goto('/customer');
    await page.goto('/address');
});
