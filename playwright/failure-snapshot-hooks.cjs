// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

function browserContextFromFixtures(fixtures) {
    try {
        if (fixtures?.context) return fixtures.context;
        if (typeof fixtures?.page?.context === 'function') return fixtures.page.context();
    } catch { /* The page or browser may already be unavailable. */ }
    return undefined;
}

function wrapFailureCallback(callback, capture, phase) {
    async function wrapped(...args) {
        try {
            return await Reflect.apply(callback, this, args);
        } catch (error) {
            const testInfo = args.at(-1);
            if (testInfo && testInfo.expectedStatus !== 'failed') {
                try {
                    await capture(browserContextFromFixtures(args[0]), testInfo, phase, error?.message || String(error));
                } catch { /* Capturing must not replace the original test or hook failure. */ }
            }
            throw error;
        }
    }

    // Playwright parses fixture parameters using callback.toString(). Keep the original
    // source visible so both arrow and ordinary function callbacks remain valid.
    Object.defineProperty(wrapped, 'toString', {value: () => callback.toString()});
    return wrapped;
}

function wrapLastCallback(args, capture, phase) {
    const wrapped = [...args];
    for (let index = wrapped.length - 1; index >= 0; index--) {
        if (typeof wrapped[index] === 'function') {
            wrapped[index] = wrapFailureCallback(wrapped[index], capture, phase);
            break;
        }
    }
    return wrapped;
}

function wrapTestType(testType, capture) {
    const symbol = Object.getOwnPropertySymbols(testType).find(key => key.description === 'testType');
    const implementation = testType[symbol];
    // Use the pinned Playwright runner's callsite mapper. Raw V8 frames point at
    // transformed JavaScript, whose line numbers can differ from the original spec.
    const withLocation = implementation && require('playwright/lib/common').transform.wrapFunctionWithLocation;

    function registration(register) {
        return withLocation
            ? withLocation(register)
            : (...args) => register(undefined, ...args);
    }

    function wrapRegistration(original, phase, register) {
        return registration((location, ...args) => {
            const wrapped = wrapLastCallback(args, capture, phase);
            return implementation ? register(location, ...wrapped) : Reflect.apply(original, testType, wrapped);
        });
    }

    const test = wrapRegistration(testType, 'test-body', (location, ...args) => implementation._createTest('default', location, ...args));
    const methods = new Map();
    if (typeof testType.extend === 'function') {
        methods.set('extend', registration((location, ...args) => {
            const extended = implementation ? implementation._extend(location, ...args) : testType.extend(...args);
            return wrapTestType(extended, capture);
        }));
    }
    for (const name of ['beforeEach', 'afterEach', 'beforeAll', 'afterAll']) {
        if (typeof testType[name] === 'function') {
            methods.set(name, wrapRegistration(testType[name], `${name}-hook`, (location, ...args) => implementation._hook(name, location, ...args)));
        }
    }
    if (typeof testType.only === 'function') {
        methods.set('only', wrapRegistration(testType.only, 'test-only', (location, ...args) => implementation._createTest('only', location, ...args)));
    }
    for (const name of ['skip', 'fixme', 'fail']) {
        const original = testType[name];
        if (typeof original !== 'function') continue;
        const modifier = registration((location, ...args) => {
            // Only the named test overload has a test body. Leave fixture
            // predicates synchronous or asynchronous as the caller defined them.
            const wrapped = typeof args[0] === 'string' ? wrapLastCallback(args, capture, `test-${name}`) : args;
            return implementation ? implementation._modifier(name, location, ...wrapped) : Reflect.apply(original, testType, wrapped);
        });
        const attached = Object.getOwnPropertyDescriptors(original);
        delete attached.name;
        delete attached.length;
        if (name === 'fail' && typeof original.only === 'function') {
            attached.only.value = wrapRegistration(original.only, 'test-fail', (location, ...args) => implementation._createTest('fail.only', location, ...args));
        }
        Object.defineProperties(modifier, attached);
        methods.set(name, modifier);
    }

    // Unchanged functions keep their identity and attached APIs, such as
    // describe.serial.only, step.skip and expect.soft.
    for (const key of Reflect.ownKeys(testType)) {
        if (key === 'length' || key === 'name') continue;
        const descriptor = Object.getOwnPropertyDescriptor(testType, key);
        if (methods.has(key)) descriptor.value = methods.get(key);
        Object.defineProperty(test, key, descriptor);
    }
    return test;
}

module.exports = {wrapTestType};
