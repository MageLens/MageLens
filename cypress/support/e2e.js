// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

require('./javascript-coverage');
const {registerTemplateCoverage} = require('@vitaliiboiko/magento-template-coverage/cypress');
registerTemplateCoverage({outputDir: 'coverage/raw/templates'});

const {disablePageTransitions} = require('../../bin/browser-navigation.cjs');
Cypress.on('window:before:load', disablePageTransitions);

// Diagnostic branch only: preserve the failure and add navigation timing,
// without recording cookies, form values, URLs, private source, or credentials.
const navigationTrace = [];
function recordNavigation(event, win = Cypress.state('window')) {
    const document = win?.document;
    navigationTrace.push({
        event, ready: document?.readyState,
        bootstrap: Boolean(win?.Cypress),
        initial: Boolean(document && /(?:^|; )__cypress\.initial=true(?:;|$)/.test(document.cookie)),
        area: win?.location?.pathname.startsWith('/admin') ? 'admin' : 'storefront',
        adoptedRules: document ? document.adoptedStyleSheets.flatMap(sheet =>
            [...sheet.cssRules].filter(rule => rule.cssText.startsWith('@view-transition')).map(rule => rule.cssText)) : [],
        activeTransition: Boolean(document?.activeViewTransition)
    });
    if (navigationTrace.length > 60) navigationTrace.shift();
}
Cypress.on('command:start', command => recordNavigation('command:' + command.attributes.name));
Cypress.on('window:before:unload', () => recordNavigation('before-unload'));
Cypress.on('window:before:load', win => {
    recordNavigation('before-load', win);
    for (const name of ['pagereveal', 'pageswap', 'load', 'DOMContentLoaded']) {
        win.addEventListener(name, event => recordNavigation(name + ':' + Boolean(event.viewTransition), win));
    }
});
Cypress.on('fail', error => {
    error.message += '\nNavigation trace: ' + JSON.stringify(navigationTrace);
    throw error;
});

beforeEach(() => {
    const run = Cypress.expose('coverageRun');
    expect(run, 'current PHP collection token').to.match(/^[a-f0-9]{32}$/);
    // Avoid intercepting multipart bodies: header mutation can corrupt binary uploads.
    cy.setCookie('application_coverage', run, {
        domain: new URL(Cypress.config('baseUrl')).hostname, path: '/', sameSite: 'lax', httpOnly: true
    });
});
