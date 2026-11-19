// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

require('./javascript-coverage');
const {registerTemplateCoverage} = require('@magelens/magento-template-coverage/cypress');
registerTemplateCoverage({outputDir: 'coverage/raw/templates'});

const {disablePageTransitions, installCypressAdminDependencies} = require('../../bin/browser-navigation.cjs');
Cypress.on('window:before:load', disablePageTransitions);

const {currentAttempt, setAttempt} = require('./attempt');
beforeEach(function () {
    // Each attempt, including a retry, has its own ID; see docs/coverage.md#test-attempts.
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    cy.task('mageLensAttempt', {event: 'start', id, spec: Cypress.spec.relative,
        test: Cypress.currentTest.titlePath, retry: this.currentTest.currentRetry()}, {log: false}).then(() => setAttempt(id));
    installCypressAdminDependencies();
    const run = Cypress.expose('coverageRun');
    expect(run, 'current PHP collection token').to.match(/^[a-f0-9]{32}$/);
    // Avoid intercepting multipart bodies: header mutation can corrupt binary uploads.
    const cookie = {domain: new URL(Cypress.config('baseUrl')).hostname, path: '/', sameSite: 'lax', httpOnly: true};
    cy.setCookie('application_coverage', run, cookie);
    cy.setCookie('application_coverage_attempt', id, cookie);
});
afterEach(function () {
    const attempt = currentAttempt();
    if (!attempt) return;
    // Mocha leaves the state unset on an attempt that will be retried.
    cy.task('mageLensAttempt', {event: 'finish', id: attempt, outcome: this.currentTest.state || 'failed'}, {log: false});
    setAttempt(null);
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
