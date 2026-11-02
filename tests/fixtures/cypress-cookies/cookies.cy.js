// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
it('preserves the actual browser cookie when a page clears a server message', () => {
  cy.visit('/set');
  cy.getCookie('message').its('value').should('equal', '');
  cy.get('button').click();
  cy.get('#received').should('have.text', 'message=');
});
it('preserves a cleared message after an earlier same-origin navigation', () => {
  cy.visit('/start');
  cy.get('button').click();
  cy.getCookie('message').its('value').should('equal', '');
  cy.get('button').click();
  cy.get('#received').should('have.text', 'message=');
});
it('preserves a cookie updated by application JavaScript', () => {
  cy.visit('/set-update');
  cy.getCookie('message').its('value').should('equal', 'updated');
  cy.get('button').click();
  cy.get('#received').should('have.text', 'message=updated');
});
it('does not restore a cookie deleted by application JavaScript', () => {
  cy.visit('/set-delete');
  cy.getCookie('message').should('equal', null);
  cy.get('button').click();
  cy.get('#received').should('have.text', 'absent');
});
it('preserves login state through a cross-origin authorization page', () => {
  cy.visit('/oauth-login');
  cy.get('a').click();
  cy.origin(Cypress.env('authorizationOrigin'), () => {
    cy.get('button').click();
  });
  cy.get('#received').should('have.text', 'oauth_state=csrf-token');
});
it('preserves login state through a cross-site server redirect chain', () => {
  cy.visit('/oauth-fast-login');
  cy.get('a').click();
  cy.get('#received').should('have.text', 'oauth_state=csrf-token');
});
it('preserves a page-cleared cookie after a same-origin server redirect', () => {
  cy.visit('/start-redirect-set');
  cy.get('button').click();
  cy.getCookie('message').its('value').should('equal', '');
  cy.get('button').click();
  cy.get('#received').should('have.text', 'message=');
});
it('does not replay a cleared cookie on a later same-origin redirect hop', () => {
  cy.visit('/set-redirect-next');
  cy.getCookie('message').its('value').should('equal', '');
  cy.get('button').click();
  cy.get('#received').should('have.text', 'message=');
});
it('retains cross-site login state after additional same-origin redirect hops', () => {
  cy.visit('/oauth-multi-login');
  cy.get('a').click();
  cy.get('#received').should('have.text', 'oauth_state=csrf-token');
});
