// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {verifyScriptPolicy} = require('../csp-proof');
describe('Magento storefront coverage compatibility', () => {
    it('collects real PHP, JavaScript and template execution', () => {
        cy.visit('/coverageprobe/');
        if (Cypress.expose('hyvaCsp')) {
            cy.request('/coverageprobe/').then(response => {
                const policy = response.headers['content-security-policy'];
                expect(policy).to.contain('script-src');
                expect(policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1]).not.to.contain("'unsafe-eval'");
                expect(policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1]).not.to.contain("'unsafe-inline'");
            });
            cy.window().then(win => verifyScriptPolicy(win.document)).then(proof => {
                expect(proof).to.deep.equal({evalBlocked: true, inlineBlocked: true, inlineExecuted: false});
                cy.writeFile('coverage/csp-proof.json', {theme: 'Hyva/default-csp', runner: 'cypress', ...proof});
            });
        }
        cy.get('[data-cy="inline-probe"]').should('have.text', 'inline-ready');
        cy.window().its('magelensChildScript').should('equal', 'child-ready');
        cy.get('[data-cy="probe-count"]').should('have.text', '0');
        cy.get('[data-cy="probe-increment"]').click();
        cy.get('[data-cy="probe-count"]').should('have.text', '1');
        cy.get('[data-cy="probe-name"]').clear().type('coverage');
        cy.get('[data-cy="probe-echo"]').should('have.text', 'coverage');
        cy.get('[data-cy="probe-save"]').click();
        cy.get('[data-cy="probe-saved"]').should('have.text', 'Saved coverage');
        cy.get('[data-cy="probe-item"]').should('have.length', 2);
        cy.get('[data-cy="probe-never"]').should('not.exist');
        cy.get('[data-cy="probe"]').then(probe => {
            if (!probe.find('[data-cy="probe-image"]').length) return;
            cy.window().then(win => {
                win.dispatchEvent(new win.CustomEvent('update-gallery-42', {detail: 'gallery-updated'}));
                win.dispatchEvent(new win.CustomEvent('update-prices-42', {detail: 'price-updated'}));
                const event = new win.Event('submit', {bubbles: true, cancelable: true});
                win.document.querySelector('[data-cy="probe-prevented"]').dispatchEvent(event);
                expect(event.defaultPrevented).to.equal(true);
            });
            cy.get('[data-cy="probe-image"]').should('have.text', 'gallery-updated');
            cy.get('[data-cy="probe-price"]').should('have.text', 'price-updated');
        });
        cy.visit('/customer/account/login/');
        cy.get('#email').should('be.visible');
    });
    it('starts the next test with fresh state', () => {
        cy.visit('/coverageprobe/');
        cy.get('[data-cy="inline-probe"]').should('have.text', 'inline-ready');
        cy.window().its('magelensChildScript').should('equal', 'child-ready');
        cy.get('[data-cy="probe-count"]').should('have.text', '0');
        cy.get('[data-cy="probe-name"]').should('have.value', 'initial');
    });
});
