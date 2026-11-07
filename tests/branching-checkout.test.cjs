// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {allocateReference, assertOrder, ADDRESS, CASES} = require('./fixtures/branching/checkout-state.cjs');

test('order allocation survives application-state restoration and rejects stale ownership', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-checkout-ledger-'));
    try {
        fs.mkdirSync(path.join(root, '.runtime'));
        const first = allocateReference(root, 'run-a', 'simple-paid');
        // A new caller/run must use the durable ledger, even after losing all in-memory state.
        const second = allocateReference(root, 'run-b', 'simple-paid');
        assert.equal(second, first + 1);
        const file = path.join(root, '.runtime/checkout-order-reference.json');
        fs.mkdirSync(file + '.lock');
        assert.throws(() => allocateReference(root, 'run-c', 'simple-paid'), /EEXIST/);
        assert.equal(JSON.parse(fs.readFileSync(file)).next, second + 1);
        fs.rmdirSync(file + '.lock');
        fs.writeFileSync(file, JSON.stringify({purpose: 'unowned', next: 1000000200}));
        assert.throws(() => allocateReference(root, 'run-c', 'simple-paid'));
        assert.equal(JSON.parse(fs.readFileSync(file)).next, 1000000200);
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

function paidSimple() {
    return {customer: 'checkout-probe@example.test', group: 'Branch checkout group',
        savedAddresses: [{address: {...ADDRESS}, defaultShipping: true, defaultBilling: true}], pendingQueues: [], items: [],
        sourceStock: ['checkout-simple', 'checkout-small', 'checkout-large', 'checkout-component-a', 'checkout-component-b']
            .map(sku => ({sku, source: 'default', qty: 1000, status: 1})),
        coupons: {CHECKOUT10: {coupon: 0, rule: 0, customer: 0}, CHECKOUTFREE: {coupon: 0, rule: 0, customer: 0}},
        reservations: [{sku: 'checkout-simple', qty: -1}],
        orders: [{customer: 'checkout-probe@example.test', group: 'Branch checkout group', state: 'new', status: 'pending',
            currency: 'USD', coupon: null, shipping: 'flatrate_flatrate',
            money: {subtotal: 2000, grand_total: 2500, discount_amount: 0, shipping_amount: 500, shipping_discount_amount: 0, tax_amount: 0},
            totalDue: 2500, totalPaid: 0, payment: 'checkmo', addresses: {billing: {...ADDRESS}, shipping: {...ADDRESS}},
            invoices: 0, shipments: 0, transactions: 0,
            items: [{productSku: 'checkout-simple', sku: 'checkout-simple', type: 'simple', parentSku: null,
                qty: 1, price: 2000, rowTotal: 2000, discount: 0, tax: 0, attributes: [], bundleOptions: []}]}]};
}
test('checkout assertions detect leaked siblings, wrong address/payment/totals and deferred work', () => {
    assertOrder(paidSimple(), 'simple', CASES[0]);
    const mutations = [
        s => s.orders.push(structuredClone(s.orders[0])),
        s => s.orders[0].addresses.shipping.street = 'Wrong street',
        s => s.orders[0].payment = 'free',
        s => s.orders[0].money.grand_total = 2000,
        s => s.coupons.CHECKOUT10.coupon = 1,
        s => s.reservations.push({sku: 'checkout-large', qty: -1}),
        s => s.pendingQueues.push({name: 'sales.rule.update.coupon.usage', status: 2, count: 1}),
        s => s.orders[0].items[0].qty = 2,
        s => s.sourceStock[0].qty = 999
    ];
    for (const mutate of mutations) { const state = paidSimple(); mutate(state); assert.throws(() => assertOrder(state, 'simple', CASES[0])); }
});
