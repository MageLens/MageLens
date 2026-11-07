// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {expect} = require('@playwright/test');
const {fileDigest} = require('../../branching/engine.cjs');

module.exports = {
    workflow: {
        identity: {
            source: fileDigest(__filename), fixture: 'existing-disposable-storefront',
            configuration: 'guest-storefront-v1', dependencies: fileDigest('src/composer.lock'),
            implementation: 'branching-storefront-example-v1'
        },
        stages: [{id: 'storefront-ready', run: async runtime => {
            await runtime.page.goto('/');
        }, assert: async runtime => {
            await expect(runtime.page.locator('body')).toBeVisible();
            await expect(runtime.page).not.toHaveTitle(/Exception|Error/i);
        }}],
        specs: [
            {id: 'view-cart', parent: 'storefront-ready', run: async runtime => {
                await runtime.page.goto('/checkout/cart/');
            }, assert: async runtime => { await expect(runtime.page).toHaveURL(/\/checkout\/cart\//); }},
            {id: 'view-login', parent: 'storefront-ready', run: async runtime => {
                await runtime.page.goto('/customer/account/login/');
            }, assert: async runtime => {
                await expect(runtime.page.locator('input[name="login[username]"]')).toBeVisible();
            }}
        ]
    },
    // A read-only smoke example. Checkout workflows should inspect their
    // customer's quote, items, totals, addresses and relevant session files.
    state: async runtime => ({orders: runtime.sql('SELECT COUNT(*) FROM sales_order')})
};
