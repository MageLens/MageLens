// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {test} from '@playwright/test';

test('first continuation', async ({page}) => {
    await page.goto('/fixture/shared');
    await page.getByRole('heading').waitFor();
    await page.getByRole('button', {name: 'First'}).click();
});
test('second continuation', async ({page}) => {
    await page.goto('/fixture/shared');
    await page.getByRole('heading').waitFor();
    await page.getByRole('button', {name: 'Second'}).click();
});
