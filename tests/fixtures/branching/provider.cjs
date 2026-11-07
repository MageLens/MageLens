// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {fileDigest} = require('../../../branching/engine.cjs');

// A deliberately small contract fixture. It is not Magento, a browser or a
// measured implementation of any complete application checkpoint candidate.
class FixtureProvider {
    constructor({work = 0} = {}) {
        this.work = work; this.approaches = ['L0', 'branching'];
        this.workload = 'contract-fixture'; this.capability = 'serialized-fixture';
        this.identity = {version: fileDigest(__filename), work}; this.coverageKind = 'fixture-events';
    }
    async prepare() {}
    async reset() { this.state = {db: {customer: null, cart: [], shipping: null, coupon: null}, files: {}, cache: {}, browser: {cookies: [], url: '/'}}; }
    async beginSegment() { this.hits = new Set(); }
    async endSegment() { return {kind: this.coverageKind, complete: true, hits: [...this.hits].sort()}; }
    hit(point) { this.hits.add(point); }
    async costly() { for (let i = 0; i < this.work; i++) createHash('sha256').update('synthetic-prefix-' + i).digest(); }
    async barrier() {
        if (this.inFlight || this.transaction || this.queue) throw new Error('Unquiesced fixture');
    }
    async capture(directory) { fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(this.state), {mode: 0o600}); }
    async restore(directory) { this.state = JSON.parse(fs.readFileSync(path.join(directory, 'state.json'))); }
    async normalizedState() { return structuredClone(this.state); }
    async cleanup() { this.state = null; }
}

function fixtureWorkflow({work = 0, fanout = 2, recursive = true} = {}) {
    const stages = [
        {id: 'baseline', run: async p => { p.hit('baseline'); }, assert: async p => assert.deepEqual(p.state.db.cart, [])},
        {id: 'customer-ready', parent: 'baseline', inputs: {work}, run: async p => {
            await p.costly(); p.hit('login'); p.state.db.customer = 'synthetic'; p.state.browser.cookies = ['synthetic-session'];
        }, assert: async p => assert.equal(p.state.db.customer, 'synthetic')},
        {id: 'cart-ready', parent: 'customer-ready', run: async p => {
            p.hit('cart'); p.state.db.cart = ['sku-1', 'sku-2']; p.state.files.cart = 'parent';
            p.state.cache.cart = 2; p.state.browser.url = '/cart';
        }, assert: async p => { assert.deepEqual(p.state.db.cart, ['sku-1', 'sku-2']); assert.equal(p.state.files.cart, 'parent'); }},
    ];
    if (recursive) stages.push({id: 'shipping-selected', parent: 'cart-ready', run: async p => {
        p.hit('shipping'); p.state.db.shipping = 'fixed'; p.state.browser.url = '/checkout';
    }, assert: async p => { assert.equal(p.state.db.shipping, 'fixed'); assert.equal(p.state.db.coupon, null); }});
    const specs = [{id: 'remove-item', parent: 'cart-ready', run: async p => {
        p.hit('cart'); p.hit('remove'); p.state.db.cart.pop(); p.state.files.cart = 'removed';
        p.state.cache.cart = 1; p.state.browser.cookies.push('removed');
    }, assert: async p => { assert.deepEqual(p.state.db.cart, ['sku-1']); assert.equal(p.state.db.coupon, null); }}];
    for (let i = 0; i < fanout; i++) specs.push({id: `coupon-${i}`, parent: recursive ? 'shipping-selected' : 'cart-ready', inputs: {valid: i % 2 === 0},
        run: async (p, input) => {
            p.hit('cart'); p.hit(input.valid ? 'valid-coupon' : 'invalid-coupon');
            p.state.db.coupon = input.valid ? 'SAVE10' : null;
            p.state.files.coupon = input.valid ? 'accepted' : 'rejected'; p.state.cache.coupon = input.valid;
            p.state.browser.cookies.push('coupon-attempt');
        }, assert: async (p, input) => {
            assert.deepEqual(p.state.db.cart, ['sku-1', 'sku-2']); assert.equal(p.state.files.cart, 'parent');
            assert.equal(p.state.cache.cart, 2); assert.ok(!p.state.browser.cookies.includes('removed'));
            assert.equal(p.state.db.coupon, input.valid ? 'SAVE10' : null);
        }});
    return {identity: {source: fileDigest(__filename), fixture: 'synthetic-cart-v1', configuration: {work, fanout, recursive},
        dependencies: `node-${process.version}`, implementation: 'explicit-stage-v1'}, stages, specs};
}
module.exports = {FixtureProvider, fixtureWorkflow};
