// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Disposable spec for tests/e2e-isolated.sh: one test fails after it has executed application code.
describe('Failed run', () => {
    it('opens the storefront', () => {
        cy.visit('/');
        cy.get('body').should('be.visible');
    });
    it('fails after opening the storefront', () => {
        cy.visit('/');
        cy.get('body').should('be.visible').then(() => {
            throw new Error('Deliberate failure: the coverage run must still publish its reports.');
        });
    });
});
