// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {disablePageTransitions} = require('../../../bin/browser-navigation.cjs');
let unsupported = [];
Cypress.on('window:before:load', win => {
    disablePageTransitions(win);
    for (const name of ['Worker', 'SharedWorker', 'WebSocket']) {
        if (typeof win[name] === 'function') win[name] = new Proxy(win[name], {
            construct(target, args) { unsupported.push(name); return Reflect.construct(target, args); }
        });
    }
});

function dispatch(result = {}) {
    return cy.task('magelens:next', result, {log: false, timeout: 180000}).then(command => {
        if (command.operation === 'close') return;
        let value = null;
        if (command.operation === 'execute') {
            Function('cy', 'Cypress', 'expect', '"use strict";\n' + command.code)(cy, Cypress, expect);
        } else if (command.operation === 'visit') {
            unsupported = [];
            cy.visit(command.url);
        } else if (command.operation === 'state') {
            cy.window().then(win => { value = {url: win.location.href, unsupported: [...unsupported]}; });
        } else if (command.operation === 'evaluate') {
            cy.window().then(win => { value = Function('window', '"use strict";return (' + command.code + ')(window);')(win); });
        } else throw new Error(`Unknown Cypress operation: ${command.operation}`);
        return cy.then(() => dispatch({id: command.id, value}));
    });
}

it('MageLens checkpoint command queue', () => dispatch());
