// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {fixtures, headers, login} from './support';
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
        cy.get('#menu-magento-backend-stores > a').click();
        cy.get('[data-ui-id="menu-magento-config-system-config"] > a').click();
        cy.contains('a', 'Journal settings').click();
        cy.get('#application_blog_display-head').click();
        cy.get('#application_blog_display_heading').should('be.visible').and('have.value', 'Journal');
        for (const name of ['alias_one', 'alias_two']) cy.get('#application_blog_display_' + name).should('have.value', 'Read more from our journal');
        cy.get('#application_blog_display_hidden').should('not.exist');
        cy.get('#application_blog_editorial_unused_unused').should('not.exist');
        cy.reload();
        cy.get('#application_blog_display_heading').should('have.value', 'Journal');
    });
});
