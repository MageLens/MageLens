// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Maintainer regression: set e2e.supportFile=false and e2e.specPattern to this file.
// Controlled responses exercise the helpers without modifying Magento data.
import {visitBlog} from '../src/app/code/Application/Blog/Test/Cypress/support';

describe('Blog page readiness', {defaultCommandTimeout: 250, pageLoadTimeout: 5000}, () => {
    it('waits for template rendering and data after the document load event', () => {
        cy.intercept('GET', '**/blog/*', {
            headers: {'content-type': 'text/html'},
            body: `<html><body><script>
                window.addEventListener('load', () => {
                    setTimeout(() => {
                        document.body.insertAdjacentHTML('beforeend', '<p data-cy="status">Loading…</p>');
                        setTimeout(() => { document.querySelector('p').textContent = '8 articles'; }, 500);
                    }, 500);
                });
            </script></body></html>`
        });
        visitBlog('scenario');
        cy.get('[data-cy="status"]').should('have.text', '8 articles');
    });
});
