// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {fixtures, headers, login, navigateAdminMenu} from './support';
const {journeys} = require('../Configuration/journeys.cjs');

describe('Blog configuration', () => {
    it('uses inherited journal settings and shows the selected Admin fields', () => {
        expect(fixtures().configuration, 'isolated settings fixture ownership').to.exist;
        for (const suffix of ['', '-warm']) for (const [name, expected] of journeys) {
            cy.request({url: '/blog/index/configuration?case=' + name + suffix, headers: headers()}).then(response => {
                expect(response.status).to.equal(200);
                expect(response.body).to.deep.include(expected);
                if (name === 'value-reads') expect(response.body.multiline).to.contain('First line\nSecond line');
                if (response.body.heading) for (const key of ['numeric', 'object', 'current']) {
                    if (key in response.body) expect(response.body[key]).to.equal(response.body.heading);
                }
            });
        }
        login();
        // Follow Magento's generated secret-key URL, never synthesize an Admin URL.
        navigateAdminMenu('#menu-magento-backend-stores > a', '[data-ui-id="menu-magento-config-system-config"] > a');
        cy.contains('a', 'Journal settings').click();
        cy.intercept('POST', '**/system_config/state/**').as('saveDisplayState');
        const toggleDisplayGroup = () => {
            cy.get('#application_blog_display-head').click();
            cy.wait('@saveDisplayState').its('response.statusCode').should('equal', 200);
        };
        cy.get('#application_blog_display-state').invoke('val').then(state => {
            if (state === '0') toggleDisplayGroup();
        });
        cy.get('#application_blog_display-state').should('have.value', '1');
        cy.get('#application_blog_display_heading').should('be.visible').and('have.value', 'Journal');
        for (const name of ['alias_one', 'alias_two']) cy.get('#application_blog_display_' + name).should('be.visible').and('have.value', 'Read more from our journal');
        cy.get('#application_blog_display_hidden').should('not.exist');
        cy.get('#application_blog_editorial_unused_unused').should('not.exist');
        // Exercise both states through Magento's real toggle and persist the
        // reopened group before reloading the page.
        toggleDisplayGroup();
        cy.get('#application_blog_display-state').should('have.value', '0');
        cy.get('#application_blog_display_heading').should('not.be.visible');
        toggleDisplayGroup();
        cy.get('#application_blog_display-state').should('have.value', '1');
        cy.get('#application_blog_display_heading').should('be.visible');
        cy.intercept({method: 'GET', url: '**/system_config/edit/**', times: 1}).as('reloadSettings');
        cy.reload();
        cy.wait('@reloadSettings').its('response.headers').should('include', {
            'x-magelens-admin-observer': 'executed',
            'x-magelens-admin-preference': 'resolved',
            'x-magelens-admin-argument': 'admin label',
            'x-magelens-admin-plugin': 'short:startbbbb|after|after'
        });
        cy.get('#application_blog_display_heading').should('be.visible').and('have.value', 'Journal');
    });
});
