// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

require('./javascript-coverage');
const {registerTemplateCoverage} = require('@vitaliiboiko/magento-template-coverage/cypress');
registerTemplateCoverage({outputDir: 'coverage/raw/templates'});

const {disablePageTransitions, installCypressAdminDependencies} = require('../../bin/browser-navigation.cjs');
Cypress.on('window:before:load', disablePageTransitions);

beforeEach(() => {
    installCypressAdminDependencies();
    const run = Cypress.expose('coverageRun');
    expect(run, 'current PHP collection token').to.match(/^[a-f0-9]{32}$/);
    // Avoid intercepting multipart bodies: header mutation can corrupt binary uploads.
    cy.setCookie('application_coverage', run, {
        domain: new URL(Cypress.config('baseUrl')).hostname, path: '/', sameSite: 'lax', httpOnly: true
    });
});

// Captures the HTML source of the current page for the validation report; see docs/coverage.md#html-validation.
Cypress.Commands.add('mageLensValidateHtml', () => cy.url().then(url =>
    cy.request({url, headers: {accept: 'text/html'}, failOnStatusCode: false, followRedirect: false, timeout: 60000}).then(response =>
        cy.task('mageLensValidateHtml', {url, status: response.status, contentType: response.headers['content-type'],
            html: response.body, spec: Cypress.spec.relative, test: Cypress.currentTest.titlePath.join(' › ')}))));
