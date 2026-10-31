// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

export const fixtures = () => Cypress.expose('projectFixtures').Application_Blog;
export const headers = () => ({'x-application-coverage': Cypress.expose('coverageRun')});
export const get = (name) => cy.get(`[data-cy="${name}"]`);
export function waitForBlog() {
    // Magento loads AMD components and Knockout templates after window:load.
    // Treat that bootstrap as page loading; ordinary interactions keep their
    // shorter timeout. Cached pages resolve this check immediately.
    return cy.get('[data-cy="status"]', {timeout: Cypress.config('pageLoadTimeout')})
        .should('be.visible').and('not.contain', 'Loading');
}
export function visitBlog(query = '') {
    cy.visit('/blog/', {qs: query ? {q: query} : {}});
    return waitForBlog();
}
export function login(username = 'application', password = 'ApplicationOnly123456!') {
    cy.visit('/admin/');
    cy.get('#username').type(username);
    cy.get('#login').type(password, {log: false});
    cy.get('.action-login').click();
    cy.get('#nav').should('be.visible');
}
export function section(name) {
    cy.get('.admin__menu-overlay').should('exist');
    const clickMenu = selector => cy.get(selector).should('be.visible').then(link => {
        const element = link[0], win = element.ownerDocument.defaultView;
        element.scrollIntoView({block: 'nearest', inline: 'nearest'});
        const box = element.getBoundingClientRect();
        // Mage-OS's fixed sidebar can extend below the viewport. Click the
        // visible part of the link, keeping Cypress's normal hit-testing.
        const left = Math.max(0, box.left), right = Math.min(win.innerWidth, box.right);
        const top = Math.max(0, box.top), bottom = Math.min(win.innerHeight, box.bottom);
        expect(right, 'menu link visible width').to.be.greaterThan(left);
        expect(bottom, 'menu link visible height').to.be.greaterThan(top);
        return cy.wrap(link).click((left + right) / 2 - box.left, (top + bottom) / 2 - box.top,
            {scrollBehavior: false});
    });
    clickMenu('#menu-application-blog-manage > a');
    clickMenu(`[data-ui-id="menu-application-blog-${name}"] > a`);
    get('blog-admin').should('be.visible');
}
export function findRecord(name) {
    get('admin-search').clear().type(name);
    get('admin-search-submit').click();
    get('admin-row').should('have.length', 1).find('[data-cy="admin-edit"]').click();
    get('blog-editor').should('be.visible');
}
export function save() {
    get('admin-save').click();
    cy.get('.message-success, .message.success').should('contain', 'Saved successfully.');
}
export function remove() {
    get('admin-delete').click();
    cy.get('.modal-popup._show .action-accept').click();
    cy.get('.message-success, .message.success').should('contain', 'Deleted successfully.');
}
export function search(query, category = '') {
    get('search').clear();
    if (query) get('search').type(query);
    get('category').select(category);
    get('search-submit').click();
    get('status').should('not.contain', 'Loading');
}
