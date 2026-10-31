// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

describe('Copied custom storefront theme', () => {
    it('uses the discovered theme and executes its PHP and HTML templates', () => {
        cy.visit('/todo/');
        cy.get('[data-cy="todo-theme-php"]').should('have.text', 'A discovered custom theme');
        cy.get('[data-cy="todo-theme-template"]').should('have.text', 'Theme template executed');
    });
});
