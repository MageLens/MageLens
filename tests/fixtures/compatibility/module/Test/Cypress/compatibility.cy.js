// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {verifyScriptPolicy} = require('../csp-proof');
describe('Magento storefront coverage compatibility', () => {
    it('collects real PHP, JavaScript and template execution', () => {
        cy.visit('/coverageprobe/');
        for (const marker of ['replacement', 'equal', 'late']) {
            cy.get(`[data-layout-origin="${marker}"]`).should('have.length', 1).and('have.text', marker);
        }
        cy.get('[data-layout-origin="original"], [data-layout-origin="unvisited"]').should('not.exist');
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
        cy.visit('/coverageprobe/handle/');
        cy.get('#layout-wireframe [data-layout-handle]').should(markers => {
            expect([...markers].map(element => element.textContent)).to.deep.equal(['repeat', 'nested', 'action']);
        });
        cy.get('#layout-wireframe [data-layout-registry]').should('have.text', 'MageLens fixture wireframe');
        cy.get('#layout-wireframe #layout-left [data-layout-structure]').should(markers => {
            expect([...markers].map(element => element.textContent)).to.deep.equal(['first', 'restored']);
        });
        cy.get('#layout-wireframe #layout-right #layout-nested [data-layout-structure]').should(markers => {
            expect([...markers].map(element => element.textContent)).to.deep.equal(['anchor', 'moved']);
        });
        cy.get('#layout-removed, [data-layout-structure="hidden"]').should('not.exist');
        cy.get('[data-layout-structure-outcome]').should('have.text', 'verified');
        for (const effect of ['string', 'number', 'boolean', 'null', 'array', 'shared', 'nonshared', 'options',
            'helper', 'url', 'updater', 'text-updater', 'translation', 'actions', 'late-replacement']) {
            cy.get(`#layout-wireframe [data-layout-argument="${effect}"]`).should('have.length', 1).and('have.text', 'verified');
        }
        cy.title().should('equal', 'Effective fixture title');
        for (const element of ['html', 'head', 'body']) {
            cy.get(element).should('have.attr', `data-layout-${element}`, 'fixture');
        }
        cy.get('body').should('have.class', 'layout-head-fixture');
        cy.get('head meta[name="description"]').should('have.attr', 'content', 'Effective fixture description');
        cy.get('head meta[name="magelens-layout"]').should('have.attr', 'content', 'fixture metadata');
        cy.get('head link[href*="/css/layout-head.css"]').should('have.length', 1).and('have.attr', 'media', 'screen');
        cy.get('head link[href*="/css/layout-removed.css"], head link[href*="/css/layout-absent.css"]').should('not.exist');
        cy.get('head script[src*="/js/layout-head.js"]').should('have.attr', 'defer', 'defer');
        cy.get('head link[href="https://example.invalid/layout-alternate"]').should('have.attr', 'rel', 'alternate');
        cy.get('head link[href$="/fonts/MUI-Icons/MUI-Icons.woff2"]').should('have.length', 1);
        cy.visit('/coverageprobe/handle/?variant=selected');
        cy.get('#layout-wireframe [data-layout-handle="dynamic"]').should('have.length', 1).and('have.text', 'dynamic');
    });
});
