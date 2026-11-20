// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {installUiBrowserObserver} = require('../bin/xml-ui-browser.cjs');
const {correlateBrowserEvidence} = require('../bin/xml-browser-evidence.cjs');

const formButton = 'form.button.clicked';
const providerName = 'listing.data_source';
const formEffects = ['ui-constructed', 'ui-rendered', 'ui-action-invoked'];
const scope = {
    'listing.columns.untouched': ['ui-constructed', 'ui-rendered'],
    'listing.columns.unrendered': ['ui-constructed', 'ui-rendered'],
    'form.readonly': ['ui-constructed', 'ui-rendered'],
    'form.unrelated': ['ui-constructed', 'ui-rendered'],
    [formButton]: formEffects,
    'form.button.untouched': formEffects,
    [providerName]: ['ui-constructed'],
    [providerName + '#provider']: ['ui-reloaded'],
    'form.shared_constructor_module': ['ui-constructed', 'ui-rendered'],
};

function browser(collect = true) {
    const response = '1'.repeat(32), reload = '2'.repeat(32);
    const instances = new Map(), nodes = new Map(), scripts = [], listeners = new Map();
    const window = {
        performance: {getEntriesByType: () => collect ? [
            {serverTiming: [{name: 'magelens-response', description: response}]}
        ] : []},
        document: {
            querySelectorAll: selector => [...nodes.keys()].filter(node =>
                node.localName !== 'span' || selector.includes('span.admin__field-value')),
            addEventListener: (event, listener) => listeners.set(event, listener),
            removeEventListener: event => listeners.delete(event),
        },
        setInterval() {}, addEventListener() {},
    };
    const requirejs = function () {};
    const moduleLoads = [];
    requirejs.onResourceLoad = (context, map) => moduleLoads.push(map.id);
    const context = {defined: {}, execCb: (_name, factory, args) => factory(...args)};
    requirejs.s = {contexts: {_: context}};
    const define = (id, factory, dependencies = []) => {
        const exported = context.execCb(id, factory, dependencies);
        context.defined[id] = exported;
        requirejs.onResourceLoad(context, {id}, []);
        return exported;
    };
    installUiBrowserObserver(scope, window);
    window.requirejs = requirejs;
    listeners.get('load')();
    const registry = define('Magento_Ui/js/lib/registry/registry', () => ({
        filter: predicate => [...instances.values()].filter(predicate), get: name => instances.get(name)
    }));
    define('knockoutjs/knockout', () => ({contextFor: node => nodes.get(node)}));
    const UiElement = define('Magento_Ui/js/lib/core/element/element', () => class {
        constructor(options) { this.initConfig(options); }
        initConfig(options) { Object.assign(this, options); }
    });
    const Button = define('Magento_Ui/js/form/components/button', () => class extends UiElement {
        applyAction(callback) { return callback(this); }
    });
    const GridProvider = define('Magento_Ui/js/grid/provider', () => class extends UiElement {
        constructor(options) {
            super(options);
            this.onReload = this.onReload.bind(this);
            // The native resolver captures reload before uiRegistry registration.
            this.initial = this.reload.bind(this);
        }
        reload() {
            this.request.done(this.onReload);
            return this.request;
        }
        onReload(data) { this.data = data; }
    });
    const register = (Class, options) => {
        const instance = new Class(options);
        instances.set(instance.name, instance);
        return instance;
    };
    const underscore = {
        toArray: value => Array.from(value),
        extend: Object.assign,
        omit: ({children, ...options}, key) => {
            assert.equal(key, 'children');
            return options;
        }
    };
    const processScripts = define('mage/apply/scripts', _ => () => _.toArray(scripts.splice(0))
        .map(node => JSON.parse(node.textContent)), [underscore]);
    const runLayout = define('Magento_Ui/js/core/renderer/layout', _ => {
        const layout = _.extend({}, {
            build(_parent, node) { return registry.get(node.name) || {...node}; },
        });
        return (node, Class) => {
            const options = layout.build(null, node);
            return registry.get(options.name) || register(Class, _.omit(options, 'children'));
        };
    }, [underscore]);
    const payload = value => JSON.stringify({'*': {'Magento_Ui/js/core/app': {
        components: {form: {name: 'form', children: {button: {name: formButton, value}}}}
    }}});
    const Insert = define('Magento_Ui/js/form/components/insert', () => class {
        constructor(element) { this.contentEl = [element]; this.onRender = this.onRender.bind(this); }
        onRender(html) {
            scripts.push({element: this.contentEl[0], textContent: html});
            return processScripts();
        }
    });
    const InsertForm = define('Magento_Ui/js/form/components/insert-form', () => class extends Insert {
        onRender(html) { return super.onRender(html); }
    });
    const bind = (instance, node = {}, column = false) => nodes.set(node, column ? {$col: instance} : {$data: instance});
    const snapshot = () => window.__mageLensUiEffects.snapshot();
    return {window, instances, register, bind, UiElement, Button, GridProvider, response, reload, snapshot,
        Insert, InsertForm, payload, scripts, runLayout, moduleLoads};
}

function xhr(id) {
    return {status: 200, getResponseHeader: name => name === 'X-MageLens-Response' ? id : null};
}

test('native UI candidates require the exact registered instance and concrete bound markup', () => {
    const {register, bind, UiElement, Button, snapshot, response, instances} = browser();
    bind(register(UiElement, {name: 'listing.columns.untouched'}), {localName: 'th'}, true);
    register(UiElement, {name: 'listing.columns.unrendered'});
    bind(register(Button, {name: formButton}));
    bind(register(Button, {name: 'form.button.untouched'}));
    const elementTmpl = 'ui/form/element/text';
    bind(register(UiElement, {name: 'form.readonly', elementTmpl, uid: 'native'}), {localName: 'span', id: 'native'});
    bind(register(UiElement, {name: 'form.unrelated', elementTmpl, uid: 'different'}), {localName: 'span', id: 'wrong'});
    const plain = {name: 'form.shared_constructor_module'};
    instances.set(plain.name, plain);
    bind(plain);
    bind(new Button({name: 'listing.columns.unrendered'}));
    register(UiElement, {name: 'listing.customer.child.12345'});

    const entries = snapshot();
    assert.ok(entries.every(effect => effect.response === response && effect.candidate === true));
    assert.deepEqual(entries.filter(entry => entry.type === 'ui-constructed').map(entry => entry.identity), [
        'listing.columns.untouched', 'listing.columns.unrendered', formButton, 'form.button.untouched', 'form.readonly', 'form.unrelated'
    ]);
    assert.deepEqual(entries.filter(entry => entry.type === 'ui-rendered').map(entry => entry.identity), [
        'listing.columns.untouched', formButton, 'form.button.untouched', 'form.readonly'
    ]);
    assert.ok(!entries.some(entry => entry.type === 'ui-action-invoked'));
});

test('the initial native grid completion and first button action need no sampling', () => {
    const {register, Button, GridProvider, reload, snapshot, moduleLoads} = browser();
    const data = {value: 'PRIVATE_DO_NOT_RECORD'};
    let complete;
    const request = {done(callback) { complete = callback; return this; }};
    const provider = register(GridProvider, {name: providerName, request});
    assert.equal(provider.initial(), request);
    complete(data, 'success', xhr(reload));
    assert.equal(provider.data, data);

    const error = new Error('application error');
    const untouched = register(Button, {name: 'form.button.untouched'});
    assert.throws(() => untouched.applyAction(() => { throw error; }), thrown => thrown === error);
    const button = register(Button, {name: formButton});
    assert.equal(button.applyAction(receiver => {
        assert.equal(receiver, button);
        return data;
    }), data);

    provider.request = {done: callback => callback(data)};
    assert.equal(provider.reload(), provider.request);
    const entries = snapshot();
    assert.deepEqual(entries.filter(entry => entry.type === 'ui-action-invoked').map(entry => entry.identity), [formButton]);
    assert.deepEqual(entries.filter(entry => entry.type === 'ui-reloaded').map(entry => [entry.identity, entry.response]), [
        [providerName + '#provider', reload]
    ]);
    assert.doesNotMatch(JSON.stringify(entries), /PRIVATE_DO_NOT_RECORD/);
    assert.ok(moduleLoads.includes('Magento_Ui/js/grid/provider'), 'preserves the loader hook');
});

test('inserted configurations keep the original response through delayed construction and name reuse', () => {
    const {Insert, InsertForm, payload, scripts, runLayout, Button, instances, bind, snapshot, response} = browser();
    const insertResponse = 'a'.repeat(32), otherResponse = 'b'.repeat(32);
    const element = {contains: node => node.element === element};
    const form = new InsertForm(element);
    const listing = new Insert(element);
    const privateMarkup = payload('PRIVATE_DO_NOT_RECORD');
    scripts.push({element: {}, textContent: privateMarkup});
    const [unrelated, inserted] = form.onRender(privateMarkup, 'success', xhr(insertResponse));
    const [other] = listing.onRender(privateMarkup, 'success', xhr(otherResponse));
    const [uncollected] = form.onRender(privateMarkup, 'success', xhr(null));
    const config = parsed => parsed['*']['Magento_Ui/js/core/app'].components.form.children.button;

    const unrelatedButton = runLayout(config(unrelated), Button);
    assert.equal(runLayout(config(inserted), Button), unrelatedButton);
    assert.equal(unrelatedButton.applyAction(() => 7), 7);
    instances.delete(formButton);

    // Consume the second response first, after both AJAX callbacks have returned.
    for (const parsed of [other, inserted, uncollected]) {
        const button = runLayout(config(parsed), Button);
        bind(button);
        assert.equal(button.applyAction(() => button.value), 'PRIVATE_DO_NOT_RECORD');
        snapshot();
        instances.delete(formButton);
    }

    const entries = snapshot();
    for (const id of [insertResponse, otherResponse]) {
        assert.deepEqual(entries.filter(entry => entry.response === id).map(entry => entry.type).sort(), [...formEffects].sort());
    }
    assert.deepEqual(entries.filter(entry => entry.response === response).map(entry => entry.type), ['ui-action-invoked']);
    assert.equal(entries.length, 7);
    assert.doesNotMatch(JSON.stringify(entries), /PRIVATE_DO_NOT_RECORD/);

    const id = 'original-xml-declaration', run = 'f'.repeat(32);
    const record = {run, request: insertResponse, status: 200,
        events: [{id, type: 'ui-delivered', area: 'adminhtml', outcome: 'observed'}]};
    const declarations = new Map([[id, {path: formButton, supported: true, effects: formEffects}]]);
    const observations = entries.filter(entry => entry.response !== otherResponse).map(entry => ({...entry, run}));
    const merged = correlateBrowserEvidence(run, [record, {run, request: response, status: 200, events: []}], declarations, observations);
    assert.deepEqual([...merged.keys()], [record]);
    assert.deepEqual(merged.get(record).map(({event}) => event.type).sort(), [...formEffects].sort());
});

test('a document without a collection response produces no candidates', () => {
    const {register, Button, snapshot} = browser(false);
    const button = register(Button, {name: formButton});
    button.applyAction(() => true);
    assert.deepEqual(snapshot(), []);
});

test('a subsequent document cannot reuse the previous response ID', () => {
    const {window, register, UiElement, snapshot} = browser();
    register(UiElement, {name: 'form.readonly'});
    window.document = {};
    assert.deepEqual(snapshot(), []);
});
