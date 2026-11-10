// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const identity = (file, title, occurrence) => `cypress:${file}:${JSON.stringify(title)}:${occurrence}`;
function install({list, selected, profile = false, inventory = true}) {
    const root = globalThis, tests = [], titles = [], skips = [], errors = [], occurrences = new Map();
    const after = root.after;
    const original = Object.fromEntries(['describe', 'context', 'it', 'specify', 'before', 'after', 'beforeEach', 'afterEach'].map(name => [name, root[name]]));
    const hooks = [];
    const declaration = (name, modifier, args) => {
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
        tests.push({id, framework: 'cypress', project: 'cypress', file: Cypress.spec.absolute, line: 0, title: titlePath.join(' › '), titlePath,
            ...(profile ? {timingSource: typeof callback === 'function' ? `const work = ${callback.toString()};` : ''} : {}),
            expectedStatus: skipped ? 'skipped' : 'passed', annotations: skipped ? [{type: 'skip'}] : []});
        if (list) return original[name](title, () => {});
        if (selected && !selected.includes(id)) return;
        if (modifier === 'only') throw new Error(errors.at(-1));
        return (modifier === 'skip' ? original[name].skip : original[name])(...args);
    };
    for (const name of ['describe', 'context', 'it', 'specify']) {
        root[name] = (...args) => declaration(name, '', args);
        for (const modifier of ['skip', 'only']) root[name][modifier] = (...args) => declaration(name, modifier, args);
    }
    if (list) for (const name of ['before', 'after', 'beforeEach', 'afterEach']) root[name] = () => {};
    if (profile && !list) {
        for (const name of ['before', 'after', 'beforeEach', 'afterEach']) root[name] = (...args) => {
            const callback = args.at(-1);
            if (typeof callback === 'function') hooks.push({scope:[...titles],kind:name,source:`const hook = ${callback.toString()};`});
            return original[name](...args);
        };
        original.before(() => cy.task('magelens:timing:prepare', {file:Cypress.spec.absolute,tests:selected ? tests.filter(test=>selected.includes(test.id)) : tests,hooks}, {log:false})
            .then(() => { for (const test of tests) delete test.timingSource; }));
    }
    if (inventory) after(() => cy.task('magelens:inventory', {file: Cypress.spec.absolute, tests, errors}, {log: false}));
}
module.exports = {install, identity};
