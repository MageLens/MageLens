// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Keep instrumented templates functional without recording coverage or a PHP token.
const {observeExecution} = require('@vitaliiboiko/magento-template-coverage/browser');
const {disablePageTransitions} = require('../../bin/browser-navigation.cjs');
let win;
let lastActivity = Date.now();
let requests = new Map();
let failedRequests = [];
let requestId = 0;

function snapshot() {
    const modules = [];
    for (const [contextName, context] of Object.entries(win?.requirejs?.s?.contexts || {})) {
        for (const [id, module] of Object.entries(context.registry)) {
            if (module.enabled && !module.defined) {
                modules.push({context: contextName, id, url: module.map?.url, error: module.error?.message});
            }
        }
    }
    return {
        page: win?.location.href,
        pendingRequests: [...requests.values()].map(request => ({...request, elapsedMs: Date.now() - request.startedAt})),
        failedRequests,
        pendingModules: modules,
        initializerMarkers: win?.document.querySelectorAll('[data-mage-init], script[type="text/x-magento-init"]').length,
        quietForMs: Date.now() - lastActivity
    };
}

beforeEach(() => {
    win = undefined;
    lastActivity = Date.now();
    requests = new Map();
    failedRequests = [];
    cy.intercept({url: '**', middleware: true}, request => {
        const id = ++requestId;
        lastActivity = Date.now();
        requests.set(id, {method: request.method, url: request.url, startedAt: lastActivity});
        request.on('after:response', response => {
            requests.delete(id);
            lastActivity = Date.now();
            if (response.statusCode >= 400) failedRequests.push({method: request.method, url: request.url, status: response.statusCode});
        });
    });
});

Cypress.on('window:before:load', current => {
    win = current;
    disablePageTransitions(current);
    observeExecution(current, () => {});
});
Cypress.on('fail', error => {
    error.message += '\nWarm-up state: ' + JSON.stringify(snapshot(), null, 2);
    throw error;
});

Cypress.Commands.add('warmupReady', () => {
    // RequireJS includes text! template loads. The quiet interval lets deferred
    // mage/apply and rendering tasks run after their dependencies resolve.
    return cy.window().should(current => {
        win = current;
        const state = snapshot();
        expect(current.document.readyState, 'document loaded').to.equal('complete');
        // Declaration markers can remain in dynamically rendered markup. They
        // describe initialization, rather than counting unfinished async work.
        expect(state.pendingModules, 'RequireJS components and templates resolved').to.deep.equal([]);
        expect(state.pendingRequests, 'browser requests completed').to.deep.equal([]);
        expect(state.quietForMs, 'no new requests for one second').to.be.at.least(1000);
    });
});

afterEach(function () {
    cy.task('warmup:diagnostics', {
        spec: Cypress.spec.relative, test: this.currentTest.fullTitle(),
        failed: this.currentTest.state === 'failed', ...snapshot()
    }, {log: false});
});
