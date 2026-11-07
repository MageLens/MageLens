// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {expect} = require('@playwright/test');
const {fileDigest} = require('../../branching/engine.cjs');

// Read-only guest storefront examples. Extend these assertions and the semantic
// state reader for the exact customer/cart/order data of a write scenario.
module.exports = {
    identity: 'existing-disposable-guest-storefront',
    dependencies: fileDigest('src/composer.lock'),
    async assertCheckpoint(runtime) {
        await expect(runtime.page.locator('body')).toBeVisible();
        await expect(runtime.page).not.toHaveTitle(/Exception|Error/i);
    },
    state: async runtime => ({orders: runtime.sql('SELECT COUNT(*) FROM sales_order')})
};
