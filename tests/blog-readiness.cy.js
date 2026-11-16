// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Maintainer regression: set e2e.supportFile=false and e2e.specPattern to this file.
// Controlled responses exercise the helpers without modifying Magento data.
import {visitBlog, navigateAdminMenu} from '../src/app/code/Application/Blog/Test/Cypress/support';

describe('Blog page readiness', {defaultCommandTimeout: 250, pageLoadTimeout: 5000}, () => {
    it('waits for Admin menu initialization before clicking the visible parent', () => {
        cy.intercept('GET', '**/admin/*', {
            headers: {'content-type': 'text/html'},
            body: `<html><body>
                <div id="stores"><a href="#">Stores</a></div>
                <div id="configuration" style="visibility:hidden"><a href="#">Configuration</a></div>
                <p id="result"></p>
                <script>
                    window.addEventListener('load', () => {
                        setTimeout(() => {
                            document.querySelector('#stores > a').addEventListener('click', event => {
                                event.preventDefault();
                                document.querySelector('#configuration').style.visibility = 'visible';
                            });
                            document.querySelector('#configuration > a').addEventListener('click', event => {
                                event.preventDefault();
                                document.querySelector('#result').textContent = 'Configuration opened';
                            });
                            document.body.insertAdjacentHTML('beforeend', '<div class="admin__menu-overlay"></div>');
                        }, 500);
                    });
                </script>
            </body></html>`
        });
        cy.visit('/admin/');
        navigateAdminMenu('#stores > a', '#configuration > a');
        cy.get('#result').should('have.text', 'Configuration opened');
    });

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
