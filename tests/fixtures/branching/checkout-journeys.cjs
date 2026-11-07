// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {Graph, fileDigest} = require('../../../branching/engine.cjs');
const {allocateReference, assertNoOrders, assertCart, assertOrder, money, PRODUCTS, CASES, EMAIL} = require('./checkout-state.cjs');
const ui = require('./checkout-ui.cjs');
function hostOwner(file) {
    const uid = Number(process.env.MAGELENS_HOST_UID), gid = Number(process.env.MAGELENS_HOST_GID);
    if (Number.isSafeInteger(uid) && Number.isSafeInteger(gid)) fs.chownSync(file, uid, gid);
}


function workflow(backend, fixture, orders, evidence) {
    const stages = [], specs = [];
    for (const product of Object.keys(PRODUCTS)) {
        stages.push({id: 'checkout-' + product,
            // Reviewed count of awaited browser actions/assertions in these
            // helpers, including the stage assertion. SQL validation is not a
            // browser action. The Rust planner uses only the static constants.
            actionUnits: {simple: 34, configurable: 36, bundle: 39}[product],
            run: async p => {
                assertNoOrders(await p.normalizedState());
                await ui.customer(p); await ui.cart(p, product, fixture.products[product]);
                assertCart(await p.normalizedState(), product, false);
                await ui.shipping(p);
            }, assert: async p => { await ui.ready(p); assertCart(await p.normalizedState(), product, true); }});
        for (const variant of CASES) {
            const id = product + '-' + variant.id;
            specs.push({id, parent: 'checkout-' + product, run: async p => {
                const expected = money(product, variant);
                await ui.payment(p, variant, expected);
                const allocation = allocateReference(backend.workspace, p.run, id);
                backend.php('allocate-order', {value: allocation});
                const reference = await ui.order(p, product, variant, expected);
                await backend.drainQueues();
                const rows = backend.php('order-evidence');
                assert.equal(rows.length, 1, 'Exactly one order per isolated branch');
                assert.equal(Number(rows[0].entity_id), allocation);
                assert.equal(rows[0].increment_id, reference); assert.equal(rows[0].customer_email, EMAIL);
                assert.ok(!orders.some(o => o.reference === reference || o.allocation === allocation));
                orders.push({spec: id, allocation, reference, quoteId: Number(rows[0].quote_id)});
            }, assert: async p => {
                const state = await p.normalizedState(); assertOrder(state, product, variant); evidence[id] = state;
            }});
        }
    }
    for (const node of [...stages, ...specs]) for (const key of ['run', 'assert']) {
        const original = node[key];
        node[key] = async p => {
            try { return await original(p); }
            catch (error) {
                const directory = path.join(backend.workspace, '.runtime/checkout-results', p.run);
                fs.mkdirSync(directory, {recursive: true});
                hostOwner(directory);
                try {
                    await p.page.screenshot({path: path.join(directory, node.id + '-' + key + '.png'), fullPage: true, timeout: 5000});
                    fs.writeFileSync(path.join(directory, node.id + '-' + key + '.txt'), await p.page.locator('body').ariaSnapshot(), {mode: 0o600});
                    for (const file of fs.readdirSync(directory)) hostOwner(path.join(directory, file));
                } catch (diagnosticError) { error.message += '\nArtifact capture: ' + diagnosticError.message; }
                throw error;
            }
        };
    }
    return new Graph({identity: {source: 'public-hyva-csp-magento-checkout', fixture: fileDigest(path.join(__dirname, 'checkout.php')),
        configuration: {products: PRODUCTS, cases: CASES,
            ui: fileDigest(path.join(__dirname, 'checkout-ui.cjs')),
            assertions: fileDigest(path.join(__dirname, 'checkout-state.cjs'))},
        dependencies: {runtime: 'mageos4-pw1.65-chrome156',
            composer: fileDigest(path.join(backend.workspace, 'src/composer.lock')),
            orderRenderer: fileDigest(path.join(backend.workspace, 'src/vendor/hyva-themes/magento2-default-theme-csp/Magento_Sales/templates/order/items/renderer/default.phtml'))},
        implementation: fileDigest(__filename)}, stages, specs});
}
module.exports = {workflow, hostOwner};
