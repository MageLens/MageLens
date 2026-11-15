// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {renderSuite, customer, discounts, product} = require('./matrix.cjs');
const quote = JSON.stringify;
const money = value => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(value);
function renderCypressSuite(row) {
    // Reuse the original matrix constraints; never silently truncate a family.
    renderSuite(row);
    const lines = [];
    const emit = source => lines.push('    ' + source);
    const get = selector => `cy.get(${quote(selector)})`;
    const visible = selector => emit(`${get(selector)}.should('have.length', 1).should('be.visible');`);
    const text = (selector, value, contains = false) => emit(`${get(selector)}.should('have.length', 1).should($element => expect($element.text().replace(/\\s+/g, ' ').trim()).to.${contains ? 'include' : 'equal'}(${quote(value)}));`);
    const fill = (selector, value) => emit(`${get(selector)}.clear().type(${quote(value)});`);
    const click = selector => emit(`${get(selector)}.click();`);
    const check = selector => emit(`${get(selector)}.should('have.length', 1).check();`);
    const visit = route => emit(`cy.visit(${quote(route)});`);
    const count = (selector, value) => emit(`${get(selector)}.should('have.length', ${value});`);
    function login() {
        visit('/customer/account/login/');
        fill('#email', customer.email); fill('input[name="login[password]"]', customer.password);
        emit(`cy.document().should(document => {const cookie = document.cookie.split('; ').find(value => value.startsWith('form_key=')); expect(Boolean(cookie && cookie.length > 9 && document.querySelector('.login-container #login-form input[name="form_key"]')?.value === decodeURIComponent(cookie.slice(9)))).to.equal(true);});`);
        click('.login-container #send2'); visible('.box-information');
    }
    function addItems(items) {
        items.forEach((item, index) => {
            visit(item.path); text('h1', item.name); fill('#qty', '1'); click('#product-addtocart-button');
            text('.message-success', item.name, true); visit('/checkout/cart/'); count('#shopping-cart-table tbody.cart.item', index + 1);
        });
    }
    function shipping() {
        visit('/checkout/'); visible('#checkout-step-shipping'); check('input[value=flatrate_flatrate]');
        click('#shipping-method-buttons-container button.continue'); visible('#checkout-payment-method-load');
    }
    if (row.fixture) {
        if (row.fixtureState) lines.push('let checkoutState, checkoutReady;');
        lines.push('beforeEach(() => {'); login(); visit('/checkout/cart/');
        emit("cy.get('body').then($body => { if ($body.find('#shopping-cart-table tbody.cart.item').length === 0) {");
        addItems(Array.from({length: row.products}, (_, i) => product(i + 1)));
        emit('}});'); count('#shopping-cart-table tbody.cart.item', row.products); shipping();
        if (row.fixtureState) emit("cy.window().then(page => {checkoutState = {page, total: {selector: '.grand.totals .price'}, history: [], nested: {count: 0}}; checkoutReady = {cart: checkoutState};});");
        lines.push('});');
        if (row.fixtureState) {
            lines.push('afterEach(() => {');
            emit("cy.then(() => {expect(checkoutState.history).to.deep.equal(['completed']); expect(checkoutState.nested.count).to.equal(1);});");
            visible('.order-details-items'); lines.push('});');
        }
    }
    for (let variant = 0; variant < row.consumers; variant++) {
        const size = row.products * (row.levels ? 1 + Math.floor(variant / (row.variantsPerLevel ?? 2)) : 1);
        const items = Array.from({length: size}, (_, i) => product(1 + i + (row.disjoint ? variant * row.products : 0)));
        const discount = discounts[row.levels ? variant % (row.variantsPerLevel ?? 2) : variant];
        const total = (items.reduce((sum, item) => sum + item.price, 0) + 5) * (1 - Math.max(0, discount) / 100);
        lines.push(`it(${quote(`${row.id} / variant-${variant + 1}`)}, () => {`);
        if (!row.fixture) { login(); addItems(items); shipping(); }
        if (row.fixtureState) {
            emit("cy.then(() => {expect(checkoutReady.cart).to.equal(checkoutState); expect(checkoutState.history).to.deep.equal([]); expect(checkoutState.nested.count).to.equal(0);});");
            emit('cy.window().then(page => {expect(checkoutState.page).to.equal(page);});');
            emit("cy.then(() => cy.get(checkoutState.total.selector).should('have.length', 1).should('be.visible'));");
        }
        if (discount !== 0) {
            click('.discount-code .payment-option-title'); fill('#discount-code', discount < 0 ? 'MLPERF-INVALID' : `MLPERF-${discount}`);
            click('.discount-code button.action-apply'); visible(discount < 0 ? '.message-error' : '.discount-code button.action-cancel');
        }
        check(`input[value=${discount === 100 ? 'free' : 'checkmo'}]`);
        text('.grand.totals .price', money(total)); click('.payment-method._active button.checkout');
        visible('.checkout-success'); text('h1', 'Thank you for your purchase!'); click('.checkout-success a.order-number');
        count('.order-details-items .product-item-name', items.length); text('.order-details-items .grand_total .price', money(total));
        if (row.fixtureState) emit("cy.then(() => {checkoutState.history.push('completed'); checkoutState.nested.count++;});");
        lines.push('});');
    }
    return lines.join('\n') + '\n';
}
module.exports = {renderCypressSuite};
