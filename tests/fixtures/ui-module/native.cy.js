// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {installCypressAdminDependencies, disablePageTransitions} = require('../../../bin/browser-navigation.cjs');
const admin = require('../../../src/app/code/Application/Blog/Test/Cypress/support');
const {runUiJourney} = require('./module/Test/Browser/cypress.cjs');

Cypress.on('window:before:load', disablePageTransitions);
beforeEach(installCypressAdminDependencies);

it('renders and interacts with standalone UI XML through native Magento', () => {
    admin.login();
    runUiJourney(admin, false);
});
