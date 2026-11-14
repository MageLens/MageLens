// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const identity = (file, title, occurrence) => `cypress:${file}:${JSON.stringify(title)}:${occurrence}`;
function install({list, selected, profile = false, inventory = true, discoveryBaseUrl}) {
    // Skip the server availability probe while retaining the original value for
    // declaration-time configuration reads in support files and test modules.
    if (list && discoveryBaseUrl !== undefined) Cypress.config('baseUrl', discoveryBaseUrl);
    const root = globalThis, tests = [], titles = [], skips = [], errors = [], occurrences = new Map();
    const after = root.after;
    const original = Object.fromEntries(['describe', 'context', 'it', 'specify', 'before', 'after', 'beforeEach', 'afterEach'].map(name => [name, root[name]]));
    const hooks = [];
    function registrationLocation(wrapper) {
        if (!profile || !list || typeof Error.captureStackTrace !== 'function') return undefined;
        const trace = {};
        Error.captureStackTrace(trace,wrapper);
        const frame = trace.stack?.split('\n')[1];
        const match = frame && frame.match(/(https?:\/\/[^\s()]+):(\d+):(\d+)\)?$/);
        if (!match || !globalThis.location) return undefined;
        const url = new URL(match[1]);
        if (url.origin === globalThis.location.origin && url.pathname === '/__cypress/tests' && url.searchParams.has('p'))
            return {url:url.href,line:Number(match[2]),column:Number(match[3])};
        return undefined;
    }
    const declaration = (name, modifier, args, wrapper) => {
        const title = args[0], callback = args.at(-1);
        if (modifier === 'only') errors.push('Focused Cypress tests are forbidden');
        if (['describe', 'context'].includes(name)) {
            const wrapped = function () {
                titles.push(title); skips.push(modifier === 'skip');
                try { return callback.apply(this, arguments); } finally { titles.pop(); skips.pop(); }
            };
            const method = list ? original[name] : modifier === 'skip' ? original[name].skip : original[name];
            return method(...args.slice(0, -1), wrapped);
        }
        const titlePath = [...titles, title], key = JSON.stringify(titlePath), occurrence = occurrences.get(key) ?? 0;
        occurrences.set(key, occurrence + 1);
        const id = identity(Cypress.spec.absolute, titlePath, occurrence);
        const skipped = modifier === 'skip' || skips.some(Boolean) || typeof callback !== 'function';
        const entry = {id, framework: 'cypress', project: 'cypress', file: Cypress.spec.absolute, line: 0, title: titlePath.join(' › '), titlePath,
            ...(profile ? {timingSource: typeof callback === 'function' ? `const work = ${callback.toString()};` : '',
                generatedLocation:registrationLocation(wrapper)} : {}),
            expectedStatus: skipped ? 'skipped' : 'passed', annotations: skipped ? [{type: 'skip'}] : []};
        tests.push(entry);
        if (!list && selected && !selected.includes(id)) return;
        if (!list && modifier === 'only') throw new Error(errors.at(-1));
        const runnable = list ? original[name](title, () => {})
            : (modifier === 'skip' ? original[name].skip : original[name])(...args);
        const location = runnable?.invocationDetails;
        if (profile && location?.absoluteFile === entry.file &&
            Number.isInteger(location.line) && Number.isInteger(location.column)) {
            entry.timingLocation = {line:location.line,column:location.column+1};
        }
        return runnable;
    };
    function register(name, modifier) {
        return function wrapper(...args) { return declaration(name, modifier, args, wrapper); };
    }
    for (const name of ['describe', 'context', 'it', 'specify']) {
        root[name] = register(name, '');
        for (const modifier of ['skip', 'only']) root[name][modifier] = register(name, modifier);
    }
    if (profile) {
        original.before(() => {
            const payload = {file:Cypress.spec.absolute,tests:selected ? tests.filter(test=>selected.includes(test.id)) : tests,hooks};
            const frames = [...new Set([...hooks,...payload.tests].map(entry=>entry.generatedLocation?.url).filter(Boolean))];
            if (!frames.length) return cy.task('magelens:timing:prepare',payload,{log:false}).then(clearTiming);
            return cy.then(async () => {
                const maps = {};
                for (const url of frames) {
                    try {
                        const response = await fetch(url,{redirect:'error'});
                        if (!response.ok) continue;
                        const bundle = await response.text();
                        const inline = bundle.match(/sourceMappingURL=data:application\/json[^,\s]*;base64,([A-Za-z0-9+/=]+)\s*$/);
                        if (inline) maps[url] = inline[1];
                    } catch { /* A missing source map leaves the registration unresolved. */ }
                }
                return maps;
            }).then(sourceMaps=>cy.task('magelens:timing:prepare',{...payload,sourceMaps},{log:false})).then(clearTiming);
        });
        function clearTiming() {
            for (const test of tests) { delete test.timingSource; delete test.timingLocation; delete test.generatedLocation; }
        }
    }
    if (profile || list) {
        for (const name of ['before', 'after', 'beforeEach', 'afterEach']) root[name] = function wrapper(...args) {
            const callback = args.at(-1);
            const generatedLocation = registrationLocation(wrapper);
            const runnable = list
                ? (profile && typeof callback === 'function' ? original[name](...args.slice(0,-1), () => {}) : undefined)
                : original[name](...args);
            if (profile && typeof callback === 'function') {
                const details = runnable?.invocationDetails;
                const timingLocation = typeof details?.absoluteFile === 'string' &&
                    Number.isInteger(details.line) && Number.isInteger(details.column)
                    ? {file:details.absoluteFile,line:details.line,column:details.column+1} : undefined;
                hooks.push({scope:[...titles],kind:name,source:`const hook = ${callback.toString()};`,timingLocation,generatedLocation});
            }
            return runnable;
        };
    }
    if (inventory) after(() => cy.task('magelens:inventory', {file: Cypress.spec.absolute, tests, errors}, {log: false}));
}
module.exports = {install, identity};
