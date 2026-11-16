// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {observeStorefrontReadiness, lumaMessagesReady} = require('../storefront-readiness.cjs');
Cypress.on('window:before:load', observeStorefrontReadiness);

export const fixtures = () => Cypress.expose('projectFixtures').Application_Blog;
export const headers = () => ({'x-application-coverage': Cypress.expose('coverageRun')});
export const get = (name) => cy.get(`[data-cy="${name}"]`);
export function waitForStorefront() {
    if (fixtures().themePaths[0] === 'Hyva/default-csp') {
        cy.window().its('__magelensStorefrontReady').should('deep.equal', {messages: true, privateContent: true});
    } else {
        cy.window().should(win => expect(lumaMessagesReady(win), 'Luma cookie messages initialized').to.equal(true));
    }
}
export function storefrontMessage(type, text) {
    // Hyva also has an unrelated hidden authentication-popup .message.error.
    // Use the same storefront message identifiers as the Playwright suite.
    const selector = `.message-${type}, [ui-id="message-${type}"]`;
    cy.get(selector).should('contain', text);
    waitForStorefront();
    return cy.get(selector).should(elements => {
        const messages = [...elements].map(element => element.textContent.trim());
        expect(messages, `Exactly one ${type} response: ${JSON.stringify(messages)}`).to.have.length(1);
        expect(messages[0]).to.contain(text);
    });
}
export function waitForBlog() {
    waitForStorefront();
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
export function navigateAdminMenu(parent, child) {
    // The sidebar HTML is visible before Magento binds its click handlers.
    cy.get('.admin__menu-overlay', {timeout: Cypress.config('pageLoadTimeout')}).should('exist');
    const clickMenu = selector => {
        cy.get(selector).should('be.visible').then(([element]) => {
            element.scrollIntoView({block: 'nearest', inline: 'nearest'});
        });
        // Magento makes the submenu visible while it is still sliding in.
        // Wait for a clickable portion of the link before computing its offset.
        const visibleBounds = element => {
            const box = element.getBoundingClientRect();
            const win = element.ownerDocument.defaultView;
            return {
                box,
                left: Math.max(0, box.left), right: Math.min(win.innerWidth, box.right),
                top: Math.max(0, box.top), bottom: Math.min(win.innerHeight, box.bottom)
            };
        };
        return cy.get(selector).should(([element]) => {
            const {left, right, top, bottom} = visibleBounds(element);
            expect(right, 'menu link visible width').to.be.greaterThan(left);
            expect(bottom, 'menu link visible height').to.be.greaterThan(top);
        }).then(link => {
            const {box, left, right, top, bottom} = visibleBounds(link[0]);
            return cy.wrap(link).click((left + right) / 2 - box.left, (top + bottom) / 2 - box.top,
                {scrollBehavior: false});
        });
    };
    clickMenu(parent);
    clickMenu(child);
}
export function section(name) {
    navigateAdminMenu('#menu-application-blog-manage > a', `[data-ui-id="menu-application-blog-${name}"] > a`);
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
