// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

describe('Copied Vitalii/TodoList module', () => {
    it('renders PHP and adds, completes, and removes tasks through its JS and HTML template', () => {
        cy.visit('/todo/');
        cy.get('[data-cy="todo"]').should('contain', 'Tasks for today');
        cy.get('[data-cy="todo-empty"]').should('be.visible');
        cy.get('[data-cy="todo-add"]').click();
        cy.get('[data-cy="todo-item"]').should('not.exist');
        cy.get('[data-cy="todo-input"]').type('Verify all three coverage reports');
        cy.get('[data-cy="todo-add"]').click();
        cy.get('[data-cy="todo-item"]').should('have.length', 1).and('contain', 'Verify all three coverage reports');
        cy.get('[data-cy="todo-empty"]').should('not.be.visible');
        cy.get('[data-cy="todo-done"]').check();
        cy.get('[data-cy="todo-label"]').should('have.class', 'completed');
        cy.get('[data-cy="todo-remove"]').click();
        cy.get('[data-cy="todo-item"]').should('not.exist');
        cy.get('[data-cy="todo-empty"]').should('be.visible');
    });
});
