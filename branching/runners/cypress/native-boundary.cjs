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
            value = bindingsSnapshot(activeInputs);
        } else if (command.operation === 'runtime') {
            if (typeof runtime?.[command.method] !== 'function') throw new Error('Missing native runner state operation');
            cy.then(() => runtime[command.method](command.value)).then(result => { value = result ?? null; });
        } else throw new Error(`Unsupported native boundary operation: ${command.operation}`);
        return cy.then(() => dispatch({id: command.id, value}));
    });
}
function bindingsSnapshot(read) {
    try {
        const seen = new Set();
        const encode = value => {
            const type = typeof value;
            if (value === null) return ['null'];
            if (type === 'undefined') return ['undefined'];
            if (type === 'string' || type === 'boolean') return [type, value];
            if (type === 'number' && Number.isFinite(value)) return [type, Object.is(value, -0) ? '-0' : value];
            if (value && ['function', 'object'].includes(type) && bindingReaders.has(value)) {
                if (seen.has(value)) throw new Error('Aliased closure input');
                seen.add(value);
                const {id, read} = bindingReaders.get(value);
                return ['closure', id, encode(read())];
            }
            if (type !== 'object' || seen.has(value)) throw new Error('Opaque or aliased fixture input');
            seen.add(value);
            if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
                throw new Error('Opaque fixture input');
            const entries = [];
            for (const key of Reflect.ownKeys(value).sort()) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                // Never invoke fixture accessors as a side effect of checking
                // eligibility, including JSON toJSON methods and DOM getters.
                if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) throw new Error('Opaque fixture property');
                entries.push([key, descriptor.enumerable, descriptor.configurable, descriptor.writable, encode(descriptor.value)]);
            }
            return [Array.isArray(value) ? 'array' : 'object', entries];
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
        activeInputs = inputs;
        prepareBindings();
        const queue = commands(), endIndex = queue.indexOf(token.end);
        if (endIndex < 0 || token.commands.some(command=>!queue.includes(command) || command.state !== 'queued' || typeof command.skip !== 'function'))
            throw new Error('Native checkpoint queue identity changed');
        const chainers = new Set(token.commands.map(command=>command.get('chainerId')));
        const sharedSubject = queue.slice(endIndex+1).some(command=>chainers.has(command.get('chainerId')));
        const bindings = bindingsSnapshot(inputs);
        if (sharedSubject) bindings.eligible = false;
        return dispatch({boundary:{phase:'enter',checkpoint,consumer,bindings}}).then(action=>{
            token.restored = action.restored;
            if (action.restored) for (const command of token.commands) command.skip();
            token.started = performance.now(); prefixActive = !action.restored; runnerState = new Set();
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
        if (token.restored) return null;
        return dispatch({boundary:{phase:'complete',checkpoint:token.checkpoint,consumer:token.consumer,
            workMs:performance.now()-token.started,bindings:bindingsSnapshot(token.inputs),unsupportedRunnerState:[...runnerState]}});
    });
    token.end = commands().at(-1);
}
module.exports = {install, begin, end, bindingsSnapshot, changesRunnerState};
