// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

require('./javascript-coverage');
const {currentAttempt, setAttempt} = require('./attempt');
const {registerTemplateCoverage} = require('@magelens/magento-template-coverage/cypress');
// Template records carry the attempt ID where the package supports record metadata.
registerTemplateCoverage({outputDir: 'coverage/raw/templates', metadata: () => ({attempt: currentAttempt()})});
require('./failure-snapshot');

const {disablePageTransitions, installCypressAdminDependencies, observeAdminMenuNavigation} = require('../../bin/browser-navigation.cjs');
const {installUiBrowserObserver} = require('../../bin/xml-ui-browser.cjs');
const uiDocuments = new Set();
const uiExported = new WeakMap();
Cypress.on('window:before:load', win => {
    disablePageTransitions(win);
    installUiBrowserObserver(Cypress.expose('xmlUiScope') || {}, win);
    uiDocuments.add(win.__mageLensUiEffects);
});

afterEach(() => {
    const entries = [...uiDocuments].flatMap(observer => {
        const snapshot = observer.snapshot();
        const previous = uiExported.get(observer) ?? 0;
        uiExported.set(observer, snapshot.length);
        return snapshot.slice(previous);
    });
    uiDocuments.clear();
    if (entries.length) cy.task('recordXmlUiCandidates', entries, {log: false});
});

let menuTest;
Cypress.on('window:before:load', win => {
    if (win.location.origin === new URL(Cypress.config('baseUrl')).origin) {
        observeAdminMenuNavigation(win, () => menuTest?.scope, evidence => menuTest.observations.push(evidence));
    }
});

beforeEach(function () {
    // Each attempt, including a retry, has its own ID; see docs/coverage.md#test-attempts.
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    cy.task('mageLensAttempt', {event: 'start', id, spec: Cypress.spec.relative,
        test: Cypress.currentTest.titlePath, retry: this.currentTest.currentRetry()}, {log: false}).then(() => setAttempt(id));
    // With test isolation disabled, a surviving page emits no new load event.
    cy.window({log: false}).then(win => {
        if (win.__mageLensUiEffects) uiDocuments.add(win.__mageLensUiEffects);
    });
    menuTest = {scope: crypto.randomUUID(), observations: []};
    installCypressAdminDependencies();
    setCoverageCookies(id);
});
afterEach(function () {
    const attempt = currentAttempt();
    if (!attempt) return;
    // Mocha leaves the state unset on an attempt that will be retried.
    cy.task('mageLensAttempt', {event: 'finish', id: attempt, outcome: this.currentTest.state || 'failed'}, {log: false});
    // Shared setup and cleanup after this point, such as after() hooks, must not inherit the attempt.
    cy.clearCookie('application_coverage_attempt', {log: false});
    setAttempt(null);
});

afterEach(() => {
    const observations = menuTest?.observations;
    menuTest = null;
    if (observations?.length) cy.task('recordAdminMenuNavigation', observations, {log: false});
});

function setCoverageCookies(attempt) {
    const run = Cypress.expose('coverageRun');
    expect(run, 'current PHP collection token').to.match(/^[a-f0-9]{32}$/);
    // Avoid intercepting multipart bodies: header mutation can corrupt binary uploads.
    const cookie = {domain: new URL(Cypress.config('baseUrl')).hostname, path: '/', sameSite: 'lax', httpOnly: true};
    const set = cy.setCookie('application_coverage', run, cookie);
    return attempt ? cy.setCookie('application_coverage_attempt', attempt, cookie) : set;
}

Cypress.Commands.add('mageLensClearSessionCookies', () => {
    return cy.clearCookies({log: false}).then(() => setCoverageCookies(currentAttempt()));
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
