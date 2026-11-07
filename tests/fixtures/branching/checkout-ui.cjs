// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {expect: playwrightExpect} = require('@playwright/test');
const {setTimeout: delay} = require('node:timers/promises');
const {EMAIL} = require('./checkout-state.cjs');
const expect = playwrightExpect.configure({timeout: 15000});

async function settled(p) {
    const deadline = Date.now() + 30000;
    let quiet = Date.now();
    while (Date.now() - quiet < 200) {
        if (Date.now() > deadline) throw new Error('Checkout requests did not settle');
        if (p.browserState.requests.size) quiet = Date.now();
        p.browserState.check(); await delay(25);
    }
}
async function go(p, url) {
    const response = await p.page.goto(url);
    assert.ok(response?.ok(), `Application HTTP ${response?.status()} at ${url}`);
}
async function ready(p) {
    const page = p.page;
    await expect(page).toHaveURL(/\/checkout\/(?:index\/index\/)?#payment$/);
    await expect(page.locator('#checkout-payment-method-load')).toBeVisible();
    await expect(page.locator('.ship-to .shipping-information-content')).toContainText('123 Test Street');
    await expect(page.locator('.ship-via .shipping-information-content')).toContainText('Flat Rate');
    await page.waitForFunction(() => {
        const name = 'Magento_Checkout/js/model/quote';
        if (!window.require?.defined(name)) return false;
        const quote = window.require(name);
        return quote.shippingMethod()?.carrier_code === 'flatrate' && quote.shippingAddress()?.street?.[0] === '123 Test Street';
    });
    await settled(p);
}
async function totals(p, expected) {
    await p.page.waitForFunction(expected => {
        const name = 'Magento_Checkout/js/model/totals';
        if (!window.require?.defined(name)) return false;
        const totals = window.require(name), value = totals.totals();
        return !totals.isLoading() && value && Object.entries(expected).every(([key, amount]) =>
            Math.round(Number(value[key] ?? 0) * 100) === amount);
    }, expected);
    await expect(p.page.locator('.opc-block-summary .grand.totals .price')).toHaveText('$' + (expected.grand_total / 100).toFixed(2));
}
async function customer(p) {
    const page = p.page;
    await go(p, '/customer/account/login/');
    const form = page.locator('form').filter({has: page.locator('input[name="login[username]"]')});
    await expect(form).toHaveCount(1);
    await form.locator('input[name="login[username]"]').fill(EMAIL);
    await form.locator('input[name="login[password]"]').fill('CheckoutProbe9!');
    await form.getByRole('button', {name: 'Sign In', exact: true}).click();
    await expect(page.locator('.card').filter({has: page.getByRole('heading', {name: 'Contact Information', exact: true})})).toContainText(EMAIL);
    for (const kind of ['billing', 'shipping']) {
        const box = page.locator('.card').filter({has: page.getByRole('heading', {name: 'Default ' + (kind === 'billing' ? 'Billing' : 'Shipping') + ' Address', exact: true})});
        for (const value of ['123 Test Street', 'Los Angeles', '90001']) await expect(box).toContainText(value);
    }
    await settled(p);
}
async function cart(p, product, fixture) {
    const page = p.page;
    await go(p, '/catalog/product/view/id/' + fixture.id);
    if (product === 'configurable') {
        const select = page.locator('select[name="super_attribute[' + fixture.attributeId + ']"]');
        await select.selectOption(String(fixture.valueId));
        await expect(select.locator('option:checked')).toContainText('Large');
    } else if (product === 'bundle') {
        await page.getByRole('heading', {name: 'Customize Checkout bundle', exact: true}).scrollIntoViewIfNeeded();
        for (const option of fixture.options) {
            const select = page.locator('select[name="bundle_option[' + option.id + ']"]');
            await select.selectOption(String(option.selectionId));
            await expect(select.locator('option:checked')).toContainText(option.label);
        }
    }
    await page.locator('input[name="qty"]').fill('1');
    await page.getByRole('button', {name: 'Add to Cart', exact: true}).click();
    await expect(page.locator('.message.success')).toBeVisible();
    await go(p, '/checkout/cart/');
    const row = page.locator('.cart.item');
    await expect(row).toHaveCount(1); await expect(row).toContainText('Checkout ' + product);
    if (product === 'configurable') await expect(row).toContainText('Large');
    if (product === 'bundle') for (const label of ['Checkout component-a', 'Checkout component-b']) await expect(row).toContainText(label);
    await settled(p);
}
async function shipping(p) {
    await go(p, '/checkout/');
    const address = p.page.locator('.shipping-address-item.selected-item');
    await expect(address).toContainText('123 Test Street'); await expect(address).toContainText('Los Angeles');
    await p.page.locator('input[value="flatrate_flatrate"]').check();
    await p.page.getByRole('button', {name: 'Next', exact: true}).click();
    await ready(p);
}
async function payment(p, variant, expected) {
    const page = p.page;
    await ready(p);
    if (variant.coupon) {
        const block = page.locator('.discount-code');
        const title = block.locator('[data-role="title"]');
        await expect(title).toHaveAttribute('aria-expanded', /^(true|false)$/);
        if (await title.getAttribute('aria-expanded') === 'false') await title.click();
        await settled(p);
        await block.locator('#discount-code').fill(variant.coupon);
        await block.locator('#discount-code').press('Tab');
        await page.waitForFunction(code => {
            const name = 'Magento_SalesRule/js/model/coupon';
            return window.require?.defined(name) && window.require(name).getCouponCode()() === code;
        }, variant.coupon);
        await block.getByRole('button', {name: 'Apply Discount', exact: true}).click();
        await expect(block.locator('.message-success')).toBeVisible();
        await expect(block.locator('#discount-code')).toBeDisabled();
        await expect(block.locator('#discount-code')).toHaveValue(variant.coupon);
    }
    await totals(p, expected);
    const method = page.locator('.payment-method').filter({has: page.locator('input[id="' + variant.payment + '"]')});
    await expect(method).toBeVisible();
    await method.locator('label[for="' + variant.payment + '"]').click();
    await expect(method).toHaveClass(/_active/);
    await expect(method.locator('.billing-address-details')).toContainText('123 Test Street');
    await expect(method.getByRole('button', {name: 'Place Order', exact: true})).toBeEnabled();
    await settled(p);
}
async function order(p, product, variant, expected) {
    const page = p.page, method = page.locator('.payment-method._active');
    await expect(method.locator('input[id="' + variant.payment + '"]')).toHaveCount(1);
    await method.getByRole('button', {name: 'Place Order', exact: true}).click();
    await expect(page).toHaveURL(/\/checkout\/onepage\/success\//);
    const link = page.locator('.checkout-success .order-number');
    await expect(link).toBeVisible();
    const reference = (await link.innerText()).trim(); assert.match(reference, /^\d+$/);
    await link.click();
    await expect(page.getByRole('heading', {name: 'Order # ' + reference, exact: true, level: 1})).toBeVisible();
    const items = page.locator('.order-details-items');
    await expect(items).toContainText('Checkout ' + product);
    if (product === 'configurable') await expect(items).toContainText('Large');
    if (product === 'bundle') for (const label of ['Checkout component-a', 'Checkout component-b']) await expect(items).toContainText(label);
    await expect(items.locator('[data-th="Grand Total"] .price')).toHaveText('$' + (expected.grand_total / 100).toFixed(2));
    await expect(page.getByText('Payment Method', {exact: true}).locator('..')).toContainText(variant.payment === 'free' ? 'No Payment Information Required' : 'Check / Money order');
    for (const kind of ['Billing', 'Shipping']) await expect(page.getByText(kind + ' Address', {exact: true}).locator('..')).toContainText('123 Test Street');
    await settled(p); return reference;
}
module.exports = {customer, cart, shipping, ready, payment, order};
