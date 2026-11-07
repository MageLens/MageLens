// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const EMAIL = 'checkout-probe@example.test';
const ADDRESS = {firstname: 'Checkout', lastname: 'Probe', street: '123 Test Street', city: 'Los Angeles',
    region: 'California', postcode: '90001', country_id: 'US', telephone: '2025550123'};
const PRODUCTS = {
    simple: {subtotal: 2000, physical: ['checkout-simple'], products: ['checkout-simple']},
    configurable: {subtotal: 3500, physical: ['checkout-large'], products: ['checkout-configurable', 'checkout-large']},
    bundle: {subtotal: 2000, physical: ['checkout-component-a', 'checkout-component-b'],
        products: ['checkout-bundle', 'checkout-component-a', 'checkout-component-b']}
};
const CASES = [
    {id: 'paid', coupon: null, payment: 'checkmo', percent: 0},
    {id: 'discount', coupon: 'CHECKOUT10', payment: 'checkmo', percent: 10},
    {id: 'free', coupon: 'CHECKOUTFREE', payment: 'free', percent: 100}
];
const CONSUMERS = new Set(['sales.rule.update.coupon.usage', 'sales.rule.quote.trigger.recollect',
    'inventory.reservations.updateSalabilityStatus', 'inventory.reservations.update',
    'inventory.indexer.sourceItem', 'inventory.indexer.stock', 'inventory.source.items.cleanup']);
function money(product, variant) {
    const subtotal = PRODUCTS[product].subtotal, free = variant.payment === 'free';
    const discount = Math.round(subtotal * variant.percent / 100) + (free ? 500 : 0);
    return {subtotal, grand_total: subtotal + 500 - discount, discount_amount: discount ? -discount : 0,
        shipping_amount: 500, shipping_discount_amount: free ? 500 : 0, tax_amount: 0};
}
function allocateReference(workspace, run, spec) {
    // Kept outside every DB/media/session snapshot; durable for both L0 and P0.
    const file = path.join(workspace, '.runtime/checkout-order-reference.json');
    const lock = file + '.lock'; fs.mkdirSync(lock);
    try {
        const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) :
            {purpose: 'magelens-checkout-order-reference', next: 1000000000};
        assert.equal(current.purpose, 'magelens-checkout-order-reference');
        const value = current.next;
        assert.ok(Number.isSafeInteger(value) && value >= 1000000000 && value < 2000000000);
        const next = {...current, next: value + 1, lastAllocation: {value, run, spec}};
        const temporary = file + '.pending';
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try { fs.writeFileSync(fd, JSON.stringify(next) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, file);
        const directory = fs.openSync(path.dirname(file), 'r');
        try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
        return value;
    } finally { fs.rmdirSync(lock); }
}
function assertShared(state) {
    assert.equal(state.customer, EMAIL); assert.equal(state.group, 'Branch checkout group');
    assert.deepEqual(state.savedAddresses, [{address: ADDRESS, defaultShipping: true, defaultBilling: true}]);
    assert.deepEqual(state.pendingQueues, []);
    const physical = ['checkout-simple', 'checkout-small', 'checkout-large', 'checkout-component-a', 'checkout-component-b'];
    assert.ok(physical.every(sku => state.sourceStock.some(s => s.sku === sku && s.source === 'default')));
    assert.ok(state.sourceStock.every(s => s.qty === 1000 && s.status === 1), 'Unshipped source stock must remain unchanged');
}
function assertNoOrders(state) {
    assertShared(state); assert.deepEqual(state.orders, []); assert.deepEqual(state.reservations, []);
    assert.deepEqual(state.coupons, {CHECKOUT10: {coupon: 0, rule: 0, customer: 0}, CHECKOUTFREE: {coupon: 0, rule: 0, customer: 0}});
}
function assertCart(state, product, shipping) {
    assertNoOrders(state);
    assert.deepEqual(state.items.map(i => i.productSku), [...PRODUCTS[product].products].sort());
    assert.ok(state.items.every(i => i.qty === 1));
    assert.equal(state.items.filter(i => !i.parentSku).length, 1);
    for (const item of state.items.filter(i => i.parentSku)) assert.equal(item.parentSku, 'checkout-' + product);
    assert.ok(state.quote?.groupMatches); assert.equal(state.quote.coupon, null);
    if (shipping) { assert.equal(state.quote.shipping, 'flatrate_flatrate'); assert.deepEqual(state.quote.address, ADDRESS); }
}
function assertOrder(state, product, variant) {
    assertShared(state); assert.equal(state.orders.length, 1); assert.deepEqual(state.items, []);
    const order = state.orders[0], totals = money(product, variant);
    assert.equal(order.customer, EMAIL); assert.equal(order.group, 'Branch checkout group');
    assert.equal(order.state, 'new'); assert.equal(order.status, 'pending'); assert.equal(order.currency, 'USD');
    assert.equal(order.coupon, variant.coupon); assert.equal(order.shipping, 'flatrate_flatrate');
    assert.deepEqual(order.money, totals); assert.equal(order.totalDue, totals.grand_total); assert.equal(order.totalPaid, 0);
    assert.equal(order.payment, variant.payment); assert.deepEqual(order.addresses, {billing: ADDRESS, shipping: ADDRESS});
    assert.equal(order.invoices, 0); assert.equal(order.shipments, 0); assert.equal(order.transactions, 0);
    assert.deepEqual(order.items.map(i => i.productSku), [...PRODUCTS[product].products].sort());
    assert.ok(order.items.every(i => i.qty === 1 && i.tax === 0));
    const parent = order.items.find(i => !i.parentSku);
    assert.equal(order.items.filter(i => !i.parentSku).length, 1);
    assert.equal(parent.productSku, 'checkout-' + product);
    if (product === 'configurable') assert.deepEqual(parent.attributes, [{label: 'Checkout size', value: 'Large'}]);
    if (product === 'bundle') assert.deepEqual(parent.bundleOptions, [
        {label: 'Checkout component-a', value: [{title: 'Checkout component-a', qty: 1, price: 1250}]},
        {label: 'Checkout component-b', value: [{title: 'Checkout component-b', qty: 1, price: 750}]}
    ]);
    assert.deepEqual(state.reservations, [...PRODUCTS[product].physical].sort().map(sku => ({sku, qty: -1})));
    for (const [code, usage] of Object.entries(state.coupons)) {
        const count = code === variant.coupon ? 1 : 0;
        assert.deepEqual(usage, {coupon: count, rule: count, customer: count});
    }
}
module.exports = {allocateReference, assertNoOrders, assertCart, assertOrder, money, PRODUCTS, CASES, ADDRESS, EMAIL, CONSUMERS};
