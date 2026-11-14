// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const provenance = require('./performance/branching/provenance.json');
const {parse} = require('@babel/parser');
const {matrix, renderSuite} = require('./performance/branching/matrix.cjs');
const {renderCypressSuite} = require('./performance/branching/cypress.cjs');

function cypressRegistration(source) {
    const tests = [], hooks = {beforeEach: [], afterEach: []};
    const sandbox = {it: (title, fn) => tests.push({title, fn}),
        beforeEach: fn => hooks.beforeEach.push(fn), afterEach: fn => hooks.afterEach.push(fn)};
    vm.createContext(sandbox); vm.runInContext(source, sandbox);
    return {tests, hooks, sandbox};
}

test('Cypress retains every generated family, native title, fixture setup and state teardown', () => {
    let total = 0;
    for (const row of matrix) {
        const source = renderCypressSuite(row);
        const recorded = provenance.cypress.generatedSuites.find(item => item.id === row.id);
        assert.equal(createHash('sha256').update(source).digest('hex'), recorded.sha256);
        assert.equal(recorded.tests, row.consumers);
        parse(source, {sourceType: 'script'});
        const registration = cypressRegistration(source);
        assert.equal(registration.tests.length, row.consumers, row.id); total += registration.tests.length;
        assert.deepEqual(registration.tests.map(item => item.title),
            Array.from({length: row.consumers}, (_, i) => `${row.id} / variant-${i + 1}`));
        assert.equal(registration.hooks.beforeEach.length, row.fixture ? 1 : 0);
        assert.equal(registration.hooks.afterEach.length, row.fixtureState ? 1 : 0);
        assert.doesNotMatch(source, /cy\.wait|setTimeout|checkpointSelection|actionUnits|fixtureUnits/);
    }
    assert.equal(total, 128);
    assert.throws(() => renderCypressSuite({id: 'invalid', products: 0, consumers: 2}), /Invalid performance/);
});

test('both generators retain identical ordered browser actions and assertions for ordinary and nested journeys', async () => {
    for (const row of matrix.filter(item => !item.fixture)) {
        const pwTests = [], pwTrace = [], cyTrace = [];
        const page = {
            goto: route => pwTrace.push(['visit', route]),
            waitForFunction: () => pwTrace.push(['login-ready']),
            locator: selector => ({selector, fill: value => pwTrace.push(['fill', selector, value]),
                click: () => pwTrace.push(['click', selector]), check: () => pwTrace.push(['check', selector])})
        };
        const expect = locator => Object.fromEntries(['toBeVisible', 'toHaveText', 'toContainText', 'toHaveCount']
            .map(method => [method, (...args) => pwTrace.push([method, locator.selector, ...args])]));
        vm.runInNewContext(renderSuite(row).replace(/^import[^\n]+\n/, ''),
            {test: (title, fn) => pwTests.push({title, fn}), expect});
        const registered = cypressRegistration(renderCypressSuite(row));
        let selected;
        const assertion = value => ({to: {
            equal: expected => {
                if (selected === '<document>') { assert.equal(value, true); cyTrace.push(['login-ready']); }
                else cyTrace.push(['toHaveText', selected, expected]);
            }, include: expected => cyTrace.push(['toContainText', selected, expected])
        }});
        const chain = selector => {
            const api = {clear: () => api, type: value => {cyTrace.push(['fill', selector, value]); return api;},
                click: () => {cyTrace.push(['click', selector]); return api;},
                check: () => {cyTrace.push(['check', selector]); return api;},
                should: (condition, expected) => {
                    if (condition === 'be.visible') cyTrace.push(['toBeVisible', selector]);
                    else if (condition === 'have.length' && ['#shopping-cart-table tbody.cart.item', '.order-details-items .product-item-name'].includes(selector)) cyTrace.push(['toHaveCount', selector, expected]);
                    else if (typeof condition === 'function') {
                        selected = selector;
                        condition(selector === '<document>' ? {cookie: 'form_key=token', querySelector: () => ({value: 'token'})} : {text: () => ''});
                    }
                    return api;
                }};
            return api;
        };
        registered.sandbox.cy = {visit: route => cyTrace.push(['visit', route]), get: chain, document: () => chain('<document>')};
        registered.sandbox.expect = assertion;
        for (const [index, pw] of pwTests.entries()) {
            pwTrace.length = 0; cyTrace.length = 0;
            await pw.fn({page}); registered.tests[index].fn();
            assert.deepEqual(cyTrace, pwTrace, pw.title);
        }
    }
});

test('stateful Cypress fixture keeps alias identity, initial state, completion and teardown assertions', () => {
    const source = renderCypressSuite(matrix.find(row => row.fixtureState));
    for (const assertion of [
        'expect(checkoutReady.cart).to.equal(checkoutState)',
        'expect(checkoutState.history).to.deep.equal([])',
        'expect(checkoutState.nested.count).to.equal(0)',
        'expect(checkoutState.page).to.equal(page)',
        "expect(checkoutState.history).to.deep.equal(['completed'])",
        'expect(checkoutState.nested.count).to.equal(1)'
    ]) assert.ok(source.includes(assertion), assertion);
    assert.match(source, /afterEach\(/);
    assert.match(source, /checkoutState\.history\.push\('completed'\)/);
    assert.match(source, /checkoutState\.nested\.count\+\+/);
    assert.match(source, /\.order-details-items/);
    assert.match(source, /\$1,042\.00/);
});
