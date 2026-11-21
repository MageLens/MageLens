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
    const origins = new WeakMap();
    const layoutOptions = new WeakMap();
    const initialScripts = new WeakSet();
    let registry, UiElement, ko, activeInsert, navigationResponse;

    function documentResponse() {
        return navigationResponse ??= win.performance.getEntriesByType('navigation')[0]?.serverTiming
            ?.find(entry => entry.name === 'magelens-response')?.description;
    }

    function httpResponse(xhr) {
        const response = xhr?.status === 200 && xhr.getResponseHeader?.('X-MageLens-Response');
        return token.test(response) ? response : null;
    }

    function record(type, identity, response) {
        if (!token.test(response) || !Object.hasOwn(scope, identity) || !scope[identity].includes(type)) return;
        entries.set([type, identity, response].join(' '), {type, identity, response, candidate: true});
    }

    function registered(instance) {
        return UiElement && instance instanceof UiElement && typeof instance.name === 'string' &&
            componentName.test(instance.name) && registry?.get(instance.name) === instance;
    }

    function wrap(target, property, observe) {
        const method = target?.[property];
        if (typeof method !== 'function') return;
        target[property] = function (...args) {
            return observe.call(this, method, args);
        };
    }

    function markConfig(nodes, response) {
        for (const node of Object.values(nodes ?? {})) {
            if (!node || typeof node !== 'object') continue;
            origins.set(node, response);
            markConfig(node.children, response);
        }
    }

    // Follow the actual script parsed by mage/apply/scripts and the layout's
    // copies of that configuration. These facades are private to the two AMD
    // factories. The app, the global Underscore module and the config stay intact.
    function observeFactories(context) {
        wrap(context, 'execCb', function (exec, args) {
            const [name, , dependencies] = args;
            if (name === 'mage/apply/scripts' || name === 'Magento_Ui/js/core/renderer/layout') {
                const [underscore, ...rest] = dependencies;
                const facade = Object.create(underscore);
                if (name === 'mage/apply/scripts') {
                    facade.toArray = function (nodes) {
                        const array = underscore.toArray(nodes);
                        if (!array.length || array[0]?.type !== 'text/x-magento-init') return array;
                        const insert = activeInsert;
                        array.map = function (parse, receiver) {
                            return Array.prototype.map.call(this, (node, index, source) => {
                                const response = insert?.element.contains(node) ? insert.response :
                                    initialScripts.has(node) ? documentResponse() : null;
                                const parsed = parse.call(receiver, node, index, source);
                                if (response) markConfig(parsed?.['*']?.['Magento_Ui/js/core/app']?.components, response);
                                return parsed;
                            });
                        };
                        return array;
                    };
                } else {
                    // The renderer exports run(), while its build method lives
                    // on the layout object assembled inside the factory.
                    facade.extend = function (target, methods) {
                        const result = Reflect.apply(underscore.extend, underscore, arguments);
                        if (Object.hasOwn(methods ?? {}, 'build')) {
                            wrap(result, 'build', function (method, args) {
                                const node = Reflect.apply(method, this, args);
                                if (node && origins.has(args[1]) && registry?.get(node.name) !== node) {
                                    layoutOptions.set(node, origins.get(args[1]));
                                }
                                return node;
                            });
                            delete facade.extend;
                        }
                        return result;
                    };
                    facade.omit = function (node, ...keys) {
                        const options = underscore.omit(node, ...keys);
                        if (layoutOptions.has(node)) origins.set(options, layoutOptions.get(node));
                        return options;
                    };
                }
                args[2] = [facade, ...rest];
            }
            return Reflect.apply(exec, this, args);
        });
    }

    function observeInsert(prototype, base) {
        wrap(prototype, 'onRender', function (method, args) {
            const previous = activeInsert;
            // InsertForm forwards only the HTML to its parent.
            if (base && previous?.instance === this) return Reflect.apply(method, this, args);
            const element = this.contentEl?.[0];
            if (!element) return Reflect.apply(method, this, args);
            activeInsert = {instance: this, element, response: httpResponse(args[2])};
            try {
                return Reflect.apply(method, this, args);
            } finally {
                activeInsert = previous;
            }
        });
    }

    function observeModule(name, module) {
        switch (name) {
            case 'Magento_Ui/js/lib/registry/registry':
                registry = module;
                break;
            case 'ko':
            case 'knockoutjs/knockout':
                ko = module;
                break;
            case 'Magento_Ui/js/lib/core/element/element':
                UiElement = module;
                wrap(module.prototype, 'initConfig', function (method, args) {
                    if (origins.has(args[0])) origins.set(this, origins.get(args[0]));
                    return Reflect.apply(method, this, args);
                });
                break;
            case 'Magento_Ui/js/form/components/insert':
                observeInsert(module.prototype, true);
                break;
            case 'Magento_Ui/js/form/components/insert-form':
                observeInsert(module.prototype, false);
                break;
            case 'Magento_Ui/js/form/components/button':
                wrap(module.prototype, 'applyAction', function (method, args) {
                    const name = registered(this) ? this.name : null;
                    const response = name && origins.get(this);
                    const result = Reflect.apply(method, this, args);
                    if (name) record('ui-action-invoked', name, response);
                    return result;
                });
                break;
            case 'Magento_Ui/js/grid/provider':
                // The resolver saves reload during construction. Its native
                // success callback receives the jqXHR even for that first load.
                wrap(module.prototype, 'onReload', function (method, args) {
                    const name = registered(this) ? this.name : null;
                    const result = Reflect.apply(method, this, args);
                    if (name && origins.has(this)) record('ui-reloaded', name + '#provider', httpResponse(args[2]));
                    return result;
                });
                break;
        }
    }

    function observeRequireJs(require) {
        const contexts = new WeakSet();
        function attach(context) {
            if (contexts.has(context)) return;
            contexts.add(context);
            observeFactories(context);
        }
        for (const context of Object.values(require.s?.contexts ?? {})) attach(context);
        const onResourceLoad = require.onResourceLoad;
        require.onResourceLoad = function (context, map, dependencies) {
            attach(context);
            observeModule(map.id, context.defined[map.id]);
            return onResourceLoad?.call(this, context, map, dependencies);
        };
    }

    function watchRequireJs() {
        // Magento loads RequireJS as an external script. Its load event runs
        // before AMD consumers, alongside the template collector's loader hook.
        function attach() {
            if (typeof win.requirejs !== 'function' || !token.test(documentResponse())) return;
            document.removeEventListener('load', attach, true);
            observeRequireJs(win.requirejs);
        }
        document.addEventListener('load', attach, true);
        attach();
    }

    function collect() {
        if (win.document !== document || !registry || !UiElement || !ko) return;
        const names = new Map();
        for (const instance of registry.filter(item => registered(item) && Object.hasOwn(scope, item.name))) {
            const response = origins.get(instance);
            if (!response) continue;
            names.set(instance, response);
            record('ui-constructed', instance.name, response);
        }

        // A concrete element needs the matching native Knockout/registry
        // instance. The read-only text template uses a span with its field UID.
        for (const node of document.querySelectorAll('input,select,textarea,button,th,td,span.admin__field-value')) {
            const context = ko.contextFor(node);
            const instance = names.has(context?.$col) ? context.$col : context?.$data;
            if (!names.has(instance)) continue;
            if (node.localName === 'span' && (instance.elementTmpl !== 'ui/form/element/text' || node.id !== instance.uid)) continue;
            record('ui-rendered', instance.name, names.get(instance));
        }
    }

    if (Object.keys(scope).length) {
        function identifyInitialScripts() {
            for (const script of document.querySelectorAll('script[type="text/x-magento-init"]')) initialScripts.add(script);
        }
        // jQuery starts Magento's initial apply on DOM ready.
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', identifyInitialScripts, {once: true});
        else identifyInitialScripts();
        watchRequireJs();
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
