// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const config = require('../../../cypress.config.cjs');
module.exports = {
    ...config,
    retries: 0,
    e2e: {
        ...config.e2e,
        specPattern: 'tests/fixtures/ui-module/native.cy.js',
        supportFile: false,
        setupNodeEvents: undefined
    }
};
