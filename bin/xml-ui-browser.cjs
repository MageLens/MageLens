// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Self-contained because Playwright serializes this function into each document.
function installUiBrowserObserver(scope, win = window) {
    if (win.__mageLensUiEffects) return;

    const document = win.document;
    const token = /^[a-f0-9]{32}$/;
    const componentName = /^[A-Za-z0-9_:#.\/-]{1,230}$/;
    const entries = new Map();
    const wired = new WeakSet();
    let response;

    function record(type, identity, request = response) {
        if (!token.test(request) || !Object.hasOwn(scope, identity) || !scope[identity].includes(type)) return;
        const entry = {type, identity, response: request, candidate: true};
        entries.set([type, identity, request].join(' '), entry);
    }

    function nativeModule(name) {
        const require = win.requirejs;
        return typeof require === 'function' && require.defined(name) ? require(name) : undefined;
    }

    function wrap(instance, property, method, onReturn) {
        if (typeof method !== 'function' || instance[property] !== method || !Object.isExtensible(instance)) return;
        Object.defineProperty(instance, property, {
            configurable: true, writable: true, value: function (...args) {
                const result = Reflect.apply(method, this, args);
                if (this === instance) onReturn(result);
                return result;
            }
        });
    }

    function collect() {
        if (win.document !== document) return;
        if (!response) {
            const navigation = win.performance.getEntriesByType('navigation')[0];
            response = navigation?.serverTiming?.find(entry => entry.name === 'magelens-response')?.description;
            if (!token.test(response)) return;
        }
        const registry = nativeModule('uiRegistry');
        const UiElement = nativeModule('uiElement');
        const ko = nativeModule('ko');
        if (!registry || !UiElement || !ko) return;

        const Button = nativeModule('Magento_Ui/js/form/components/button');
        const GridProvider = nativeModule('Magento_Ui/js/grid/provider');
        const instances = registry.filter(item => item instanceof UiElement && typeof item.name === 'string' && componentName.test(item.name) &&
            (Object.hasOwn(scope, item.name) || Object.hasOwn(scope, item.name + '#provider')) && registry.get(item.name) === item);

        const names = new Map();
        for (const instance of instances) {
            const identity = instance.name;
            names.set(instance, identity);
            record('ui-constructed', identity);

            if (wired.has(instance)) continue;
            wired.add(instance);
            if (Button && instance instanceof Button) {
                wrap(instance, 'applyAction', Button.prototype.applyAction, () => record('ui-action-invoked', identity));
            }
            if (GridProvider && instance instanceof GridProvider) {
                wrap(instance, 'reload', GridProvider.prototype.reload, request => {
                    request?.done?.((_data, _status, xhr) => {
                        if (xhr?.status === 200) record('ui-reloaded', identity + '#provider', xhr.getResponseHeader?.('X-MageLens-Response'));
                    });
                });
            }
        }

        // Knockout's actual binding context associates a concrete element with
        // its registry instance. Shared modules, CSS classes and matching text
        // alone provide no instance evidence.
        for (const node of document.querySelectorAll('input,select,textarea,button,th,td')) {
            const context = ko.contextFor(node);
            const identity = names.get(context?.$col) ?? names.get(context?.$data);
            if (identity) record('ui-rendered', identity);
        }
    }

    // Sampling also establishes late AMD registrations after the initial load.
    // No new RequireJS loads, application values or DOM writes are required.
    if (Object.keys(scope).length) {
        win.setInterval(collect, 125);
        win.addEventListener('pagehide', collect);
    }
    win.__mageLensUiEffects = {
        snapshot() {
            collect();
            return [...entries.values()];
        }
    };
}

module.exports = {installUiBrowserObserver};
