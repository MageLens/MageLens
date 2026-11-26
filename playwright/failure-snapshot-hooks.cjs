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
    const source = Function.prototype.toString.call(callback);
    const arrowIndex = source.indexOf('=>');
    const parameterSource = arrowIndex < 0 ? null : source.slice(0, arrowIndex).replace(/^\s*async\s*/, '').trim();
    const parameters = parameterSource?.startsWith('(')
        ? parameterSource.slice(1, parameterSource.lastIndexOf(')'))
        : parameterSource;
    const wrapper = parameters === null
        ? async function (...args) {
            return invoke.call(this, this, arguments);
        }
        : new Function('invoke', `return async function (${parameters}) { return invoke.call(this, this, arguments); }`)(invoke);

    async function invoke(receiver, argsLike) {
        const args = Array.from(argsLike);
        try {
            return await callback.apply(receiver, args);
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
    return wrapper;
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
    const wrappedType = new Proxy(testType, {
        apply(target, _thisArgument, args) {
            return Reflect.apply(target, target, wrapLastCallback(args, capture, 'test-body'));
        },
        get(target, property) {
            const value = Reflect.get(target, property, target);
            if (property === 'extend' && typeof value === 'function') {
                return (...args) => wrapTestType(Reflect.apply(value, target, args), capture);
            }
            if (property === 'beforeEach' || property === 'afterEach') {
                return (...args) => Reflect.apply(value, target, wrapLastCallback(args, capture, `${property}-hook`));
            }
            if (['only', 'skip', 'fixme', 'fail'].includes(property) && typeof value === 'function') {
                return (...args) => Reflect.apply(value, target, wrapLastCallback(args, capture, `test-${property}`));
            }
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
    return wrappedType;
}

module.exports = {wrapTestType};
