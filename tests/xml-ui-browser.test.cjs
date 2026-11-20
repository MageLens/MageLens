// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {installUiBrowserObserver} = require('../bin/xml-ui-browser.cjs');

const scope = {
    'listing.columns.untouched': ['ui-constructed', 'ui-rendered'],
    'listing.columns.unrendered': ['ui-constructed', 'ui-rendered'],
    'form.button.clicked': ['ui-constructed', 'ui-rendered', 'ui-action-invoked'],
    'form.button.untouched': ['ui-constructed', 'ui-rendered', 'ui-action-invoked'],
    'listing.data_source': ['ui-constructed'],
    'listing.data_source#provider': ['ui-reloaded'],
    'form.shared_constructor_module': ['ui-constructed', 'ui-rendered'],
};
function browser() {
    const response = '1'.repeat(32), reload = '2'.repeat(32);
    class UiElement {}
    class Button extends UiElement {
        applyAction(callback) {
            return callback(this);
        }
    }
    class GridProvider extends UiElement {
        reload() {
            return this.response;
        }
    }
    const field = Object.assign(new UiElement(), {name: 'listing.columns.untouched'});
    const invisible = Object.assign(new UiElement(), {name: 'listing.columns.unrendered'});
    const button = Object.assign(new Button(), {name: 'form.button.clicked'});
    const other = Object.assign(new Button(), {name: 'form.button.untouched'});
    const provider = Object.assign(new GridProvider(), {name: 'listing.data_source'});
    const plain = {name: 'form.shared_constructor_module'};
    const recordBasedName = Object.assign(new UiElement(), {name: 'listing.customer.child.12345'});
    const registry = [field, invisible, button, other, provider, plain, recordBasedName];
    const nodes = new Map([[{}, {$col: field}], [{}, {$data: button}], [{}, {$data: other}], [{}, {$data: plain}]]);
    const modules = {
        uiElement: UiElement, uiRegistry: {filter: callback => registry.filter(callback), get: name => registry.find(value => value.name === name)},
        ko: {contextFor: node => nodes.get(node)}, 'Magento_Ui/js/form/components/button': Button,
        'Magento_Ui/js/grid/provider': GridProvider,
    };
    const requirejs = name => modules[name];
    requirejs.defined = name => name in modules;
    const window = {
        performance: {getEntriesByType: () => [{serverTiming: [{name: 'magelens-response', description: response}]}]},
        document: {querySelectorAll: () => [...nodes.keys()]}, requirejs,
        setInterval: () => 1, addEventListener() {},
    };
    return {window, field, button, other, provider, plain, response, reload, nodes};
}

test('native UI candidates require exact registry instances and bound DOM ownership', () => {
    const {window, response} = browser();
    installUiBrowserObserver(scope, window);
    const entries = window.__mageLensUiEffects.snapshot();
    assert.ok(entries.every(effect => effect.response === response && effect.candidate === true));
    assert.deepEqual(entries.filter(entry => entry.type === 'ui-constructed').map(entry => entry.identity), [
        'listing.columns.untouched', 'listing.columns.unrendered', 'form.button.clicked', 'form.button.untouched', 'listing.data_source'
    ]);
    assert.deepEqual(entries.filter(entry => entry.type === 'ui-rendered').map(entry => entry.identity), [
        'listing.columns.untouched', 'form.button.clicked', 'form.button.untouched'
    ]);
    assert.ok(!entries.some(entry => entry.type === 'ui-action-invoked'));
});

test('actions and AJAX reloads retain return identity and omit application payload', () => {
    const {window, button, provider, reload} = browser();
    installUiBrowserObserver(scope, window);
    const control = window.__mageLensUiEffects;
    control.snapshot();
    const data = {value: 'PRIVATE_DO_NOT_RECORD'};
    assert.equal(button.applyAction(receiver => {
        assert.equal(receiver, button);
        return data;
    }), data);
    const xhr = {
        status: 200,
        getResponseHeader: name => name === 'X-MageLens-Response' ? reload : null,
        done: callback => callback(data, 'success', xhr)
    };
    provider.response = xhr;
    assert.equal(provider.reload(), xhr);
    provider.response = {done: callback => callback(data)};
    assert.equal(provider.reload(), provider.response);
    const entries = control.snapshot();
    assert.deepEqual(entries.filter(entry => entry.type === 'ui-action-invoked').map(entry => entry.identity), ['form.button.clicked']);
    assert.deepEqual(entries.filter(entry => entry.type === 'ui-reloaded').map(entry => [entry.identity, entry.response]), [
        ['listing.data_source#provider', reload]
    ]);
    assert.doesNotMatch(JSON.stringify(entries), /PRIVATE_DO_NOT_RECORD/);
});

test('a document without a collection response stays untouched', () => {
    const {window, button} = browser();
    window.performance.getEntriesByType = () => [];
    const native = button.applyAction;
    installUiBrowserObserver(scope, window);
    assert.deepEqual(window.__mageLensUiEffects.snapshot(), []);
    assert.equal(button.applyAction, native);
    assert.throws(() => button.applyAction(() => { throw Error('application error'); }), /application error/);
});

test('a subsequent document cannot reuse the previous response ID', () => {
    const {window} = browser();
    installUiBrowserObserver(scope, window);
    const control = window.__mageLensUiEffects;
    window.document = {};
    assert.deepEqual(control.snapshot(), []);
});
