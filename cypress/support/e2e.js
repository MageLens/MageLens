// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

require('./javascript-coverage');
const {registerTemplateCoverage} = require('@vitaliiboiko/magento-template-coverage/cypress');
registerTemplateCoverage({outputDir: 'coverage/raw/templates'});

const {disablePageTransitions} = require('../../bin/browser-navigation.cjs');
Cypress.on('window:before:load', disablePageTransitions);

beforeEach(() => {
    const run = Cypress.expose('coverageRun');
    expect(run, 'current PHP collection token').to.match(/^[a-f0-9]{32}$/);
    // Avoid intercepting multipart bodies: header mutation can corrupt binary uploads.
    cy.setCookie('application_coverage', run, {
        domain: new URL(Cypress.config('baseUrl')).hostname, path: '/', sameSite: 'lax', httpOnly: true
    });
});
