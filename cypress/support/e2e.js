// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

require('./javascript-coverage');
const {registerTemplateCoverage} = require('@magelens/magento-template-coverage/cypress');
registerTemplateCoverage({outputDir: 'coverage/raw/templates'});

const {disablePageTransitions, installCypressAdminDependencies, observeAdminMenuNavigation} = require('../../bin/browser-navigation.cjs');
Cypress.on('window:before:load', disablePageTransitions);

let menuTest;
Cypress.on('window:before:load', win => {
    if (win.location.origin === new URL(Cypress.config('baseUrl')).origin) {
        observeAdminMenuNavigation(win, () => menuTest?.scope, evidence => menuTest.observations.push(evidence));
    }
});

beforeEach(() => {
    menuTest = {scope: crypto.randomUUID(), observations: []};
    installCypressAdminDependencies();
    const run = Cypress.expose('coverageRun');
    expect(run, 'current PHP collection token').to.match(/^[a-f0-9]{32}$/);
    // Avoid intercepting multipart bodies: header mutation can corrupt binary uploads.
    cy.setCookie('application_coverage', run, {
        domain: new URL(Cypress.config('baseUrl')).hostname, path: '/', sameSite: 'lax', httpOnly: true
    });
});

afterEach(() => {
    const observations = menuTest?.observations;
    menuTest = null;
    if (observations?.length) cy.task('recordAdminMenuNavigation', observations, {log: false});
});

// Captures the HTML source of the current page for the validation report; see docs/coverage.md#html-validation.
// The page itself requests its URL again: the browser session applies, and a failed or slow request
// becomes a record in the report. No step of this command can fail the test that calls it.
Cypress.Commands.add('mageLensValidateHtml', () => {
    cy.window({log: false}).then({timeout: 70000}, win => {
        const url = win.location.href;
        // redirect: 'manual' hides the status of a redirect; it is reported as not validated.
        return win.fetch(url, {redirect: 'manual', signal: win.AbortSignal.timeout(60000)})
            .then(async response => response.type === 'opaqueredirect' ? {redirected: true}
                : {status: response.status, contentType: response.headers.get('content-type'), html: await response.text()})
            .catch(error => ({error: String(error.message || error)}))
            .then(capture => ({...capture, url, spec: Cypress.spec.relative, test: Cypress.currentTest.titlePath.join(' › ')}));
    }).then(capture => cy.task('mageLensValidateHtml', capture, {log: false}));
});
