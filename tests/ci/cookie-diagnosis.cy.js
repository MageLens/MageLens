// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
it('preserves the actual browser cookie when a page clears a server message', () => {
  cy.visit('/set');
  cy.getCookie('message').its('value').should('equal', '');
  cy.get('button').click();
  cy.get('#received').should('have.text', 'message=');
});
