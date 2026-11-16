// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

/* global Cypress, cy */

// Boundary markers run in the original Cypress queue. Original callbacks and
// their lexical scopes are never split or reconstructed from strings.
let unsupported = [];
let prefixActive = false;
let runnerState = new Set();
let runtime;
let activeInputs;
const bindingReaders = new WeakMap();
const routeAlias = value => typeof value === 'string' && value.startsWith('@');
function changesRunnerState(command) {
    const name = command.get('name');
    if (['as', 'intercept', 'session', 'origin', 'clock', 'tick', 'spy', 'stub'].includes(name)) return true;
    // Waiting for an alias consumes an interception even when an original
    // hook registered the route outside the prefix.
    const alias = name === 'wait' && command.get('args')?.[0];
    return Array.isArray(alias) ? alias.some(routeAlias) : routeAlias(alias);
}
function hasNativePrototype(value, constructor) {
    const prototype = Object.getPrototypeOf(value);
    const ownConstructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    return typeof ownConstructor === 'function' && ownConstructor.prototype === prototype &&
        Function.prototype.toString.call(ownConstructor) === Function.prototype.toString.call(constructor);
}
const plainRecord = value => value && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === null || hasNativePrototype(value, Object));
function interceptState(routes, aliasedRequests) {
    const unknown = {operations: ['unverified-intercept-state']};
    const active = {operations: ['active-intercept']};
    try {
        if (!plainRecord(routes) || !Array.isArray(aliasedRequests)) return unknown;
        if (aliasedRequests.length) return active;
        const observed = [];
        // Route IDs are allocated afresh by the original hooks. Preserve
        // registration order and compare the matchers and responses instead.
        for (const route of Object.values(routes)) {
            if (!plainRecord(route) || !plainRecord(route.options) || !plainRecord(route.requests)) return unknown;
            if (Object.hasOwn(route, 'alias') || route.hitCount !== 0 || Reflect.ownKeys(route.requests).length || Object.hasOwn(route.options, 'times'))
                return active;
            if (typeof route.handler !== 'string' && !plainRecord(route.handler)) return active;
            observed.push([route.options, route.handler]);
        }
        if (!observed.length) return {operations: []};
        const encoded = bindingsSnapshot(() => observed, {routeData: true});
        return encoded.eligible ? {operations: [], routes: encoded.value} : unknown;
    } catch { return unknown; }
}
function boundaryState(read) {
    const bindings = bindingsSnapshot(read);
    const {operations, routes} = interceptState(cy.state('routes'), cy.state('aliasedRequests'));
    if (routes) bindings.intercepts = routes;
    return {bindings, operations};
}
function install(extension) {
    runtime = extension;
    // A source-verified adapter may expose the captured cells of specific
    // imported values. Function text alone never describes those cells.
    Cypress.on('command:start', command => {
        if (prefixActive && changesRunnerState(command)) runnerState.add(command.get('name'));
    });
    Cypress.on('window:before:load', win => {
        require('../../../bin/browser-navigation.cjs').disablePageTransitions(win);
        for (const name of ['Worker', 'SharedWorker', 'WebSocket']) {
            if (typeof win[name] === 'function') win[name] = new Proxy(win[name], {
                construct(target, args) { unsupported.push(name); return Reflect.construct(target, args); }
            });
        }
    });
}
function prepareBindings() {
    const bindings = typeof runtime?.bindings === 'function' ? runtime.bindings() : runtime?.bindings ?? [];
    const seen = new Set();
    for (const [id, {value, read}] of bindings.entries()) {
        if ((!value || !['object', 'function'].includes(typeof value)) || typeof read !== 'function' || seen.has(value) ||
            (bindingReaders.has(value) && bindingReaders.get(value).id !== id)) throw new Error('Invalid native closure state reader');
        seen.add(value); bindingReaders.set(value,{id,read});
    }
}
function dispatch(result) {
    return cy.task('magelens:next', result, {log: false, timeout: 180000}).then(command => {
        if (command.operation === 'continue') return command;
        if (command.operation === 'close') throw new Error(command.error || 'Cypress checkpoint controller closed');
        let value = null;
        if (command.operation === 'visit') {
            unsupported = [];
            cy.visit(command.url);
        } else if (command.operation === 'state') {
            cy.window().then(win => { value = {url: win.location.href, unsupported: [...unsupported]}; });
        } else if (command.operation === 'evaluate') {
            cy.window().then(win => { value = Function('window', '"use strict";return (' + command.code + ')(window);')(win); });
        } else if (command.operation === 'bindings') {
            if (!activeInputs) throw new Error('No active native lexical scope');
            const {bindings, operations} = boundaryState(activeInputs);
            value = operations.length ? {eligible: false} : bindings;
        } else if (command.operation === 'runtime') {
            if (typeof runtime?.[command.method] !== 'function') throw new Error('Missing native runner state operation');
            cy.then(() => runtime[command.method](command.value)).then(result => { value = result ?? null; });
        } else throw new Error(`Unsupported native boundary operation: ${command.operation}`);
        return cy.then(() => dispatch({id: command.id, value}));
    });
}
function bindingsSnapshot(read, {routeData = false} = {}) {
    try {
        const objects = new Map();
        const visiting = new Set();
        const closures = new Set();
        const encode = value => {
            const type = typeof value;
            if (value === null) return ['null'];
            if (type === 'undefined') return ['undefined'];
            if (type === 'string' || type === 'boolean') return [type, value];
            if (type === 'number' && Number.isFinite(value)) return [type, Object.is(value, -0) ? '-0' : value];
            if (!routeData && value && ['function', 'object'].includes(type) && bindingReaders.has(value)) {
                if (closures.has(value)) throw new Error('Aliased closure input');
                closures.add(value);
                const {id, read} = bindingReaders.get(value);
                return ['closure', id, encode(read())];
            }
            if (type !== 'object') throw new Error('Opaque fixture input');
            if (visiting.has(value)) throw new Error('Cyclic fixture input');
            if (objects.has(value)) return ['reference', objects.get(value)];
            if (routeData && hasNativePrototype(value, RegExp) && Reflect.ownKeys(value).length === 1 && value.lastIndex === 0) {
                const source = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get.call(value);
                const flags = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags').get.call(value);
                return ['regexp', source, flags];
            }
            const plain = routeData ? plainRecord(value) : [Object.prototype, null].includes(Object.getPrototypeOf(value));
            if (!Array.isArray(value) && !plain) throw new Error('Opaque fixture input');
            const id = objects.size;
            objects.set(value, id);
            visiting.add(value);
            const entries = [];
            for (const key of Reflect.ownKeys(value).sort()) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                // Never invoke fixture accessors as a side effect of checking
                // eligibility, including JSON toJSON methods and DOM getters.
                if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new Error('Opaque fixture property');
                entries.push([key, descriptor.enumerable, descriptor.configurable, descriptor.writable, encode(descriptor.value)]);
            }
            visiting.delete(value);
            return [Array.isArray(value) ? 'array' : 'object', id, entries];
        };
        return {eligible: true, value: encode(read())};
    } catch { return {eligible: false}; }
}
function commands() {
    if (typeof cy.queue?.get !== 'function') throw new Error('Unsupported Cypress command queue');
    const queue = cy.queue.get();
    if (!Array.isArray(queue)) throw new Error('Unsupported Cypress command queue inventory');
    return queue;
}
function begin(checkpoint, consumer, inputs) {
    const token = {checkpoint, consumer, inputs, restored:false};
    cy.then(() => {
        const test = cy.state('test');
        const attempt = test?.currentRetry();
        if (!Number.isSafeInteger(attempt) || attempt < 0) throw new Error('Invalid Cypress test attempt');
        token.retry = attempt > 0;
        activeInputs = inputs;
        prepareBindings();
        const queue = commands(), endIndex = queue.indexOf(token.end);
        if (endIndex < 0 || token.commands.some(command=>!queue.includes(command) || command.state !== 'queued' || typeof command.skip !== 'function'))
            throw new Error('Native checkpoint queue identity changed');
        const chainers = new Set(token.commands.map(command=>command.get('chainerId')));
        const sharedSubject = queue.slice(endIndex+1).some(command=>chainers.has(command.get('chainerId')));
        const {bindings, operations: unsupportedRunnerState} = boundaryState(inputs);
        if (sharedSubject) bindings.eligible = false;
        return dispatch({boundary:{phase:'enter',checkpoint,consumer,bindings,attempt,unsupportedRunnerState}}).then(action=>{
            if (token.retry && action.restored) throw new Error('Native Cypress retries must execute the original prefix');
            token.restored = action.restored;
            if (action.restored) for (const command of token.commands) command.skip();
            token.started = performance.now();
            prefixActive = !action.restored && !token.retry;
            runnerState = new Set();
            return null;
        });
    });
    token.begin = commands().at(-1);
    return token;
}
function end(token) {
    const queue = commands(), index = queue.indexOf(token.begin);
    if (index < 0) throw new Error('Native checkpoint start marker is missing');
    token.commands = queue.slice(index+1);
    cy.then(() => {
        prefixActive = false;
        if (token.restored || token.retry) return null;
        const workMs = performance.now() - token.started;
        const {bindings, operations} = boundaryState(token.inputs);
        return dispatch({boundary:{phase:'complete',checkpoint:token.checkpoint,consumer:token.consumer,
            workMs,bindings,unsupportedRunnerState:[...runnerState,...operations]}});
    });
    token.end = commands().at(-1);
}
module.exports = {install, begin, end, bindingsSnapshot, changesRunnerState, interceptState};
