// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

describe('Storefront warm-up', () => {
    it('loads the homepage and fixture pages with their dynamic assets', () => {
        for (const path of Cypress.expose('warmupPaths')) {
            cy.visit(path);
            cy.warmupReady();
        }
    });
});
