// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {verifyScriptPolicy} = require('../csp-proof');
const admin = require('../../../../Application/Blog/Test/Cypress/support');
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
        cy.get('#layout-left').should('have.class', 'layout-effective');
        cy.get('#layout-empty, #layout-hidden-container, [data-layout-structure="hidden-container-child"]').should('not.exist');
        cy.get('#layout-wireframe [data-layout-structure="config-allowed"]').should('have.text', 'config-allowed');
        cy.get('#layout-wireframe [data-layout-structure="config-denied"]').should('not.exist');
        for (const effect of ['string', 'number', 'boolean', 'null', 'array', 'shared', 'nonshared', 'options',
            'helper', 'url', 'updater', 'text-updater', 'translation', 'actions', 'late-replacement',
            'equal-replacement', 'unset-value', 'offset-replacement', 'offset-read', 'array-path',
            'indexed-array', 'indexed-string', 'literal-slash']) {
            cy.get(`#layout-wireframe [data-layout-argument="${effect}"]`).should('have.length', 1).and('have.text', 'verified');
        }
        cy.title().should('equal', 'Effective fixture title');
        for (const element of ['html', 'head', 'body']) {
            cy.get(element).should('have.attr', `data-layout-${element}`, 'fixture');
        }
        cy.get('body').should('have.class', 'layout-head-fixture');
        cy.get('body').should('have.class', 'page-wide');
        cy.get('head meta[name="description"]').should('have.attr', 'content', 'Effective fixture description');
        cy.get('head meta[name="magelens-layout"]').should('have.attr', 'content', 'fixture metadata');
        cy.get('head meta[name="magelens-replaced"]').should('have.attr', 'content', 'same');
        cy.get('body').should('have.attr', 'data-layout-replaced', 'same');
        cy.get('head link[href*="/css/layout-head.css"]').should('have.length', 1).and('have.attr', 'media', 'screen');
        cy.get('head link[href*="/css/layout-removed.css"], head link[href*="/css/layout-absent.css"]').should('not.exist');
        cy.get('head script[src*="/js/layout-head.js"]').should('have.attr', 'defer', 'defer');
        cy.get('head script[src*="/js/layout-head.js"]').should('have.attr', 'async', 'async');
        cy.get('head link[href="https://example.invalid/layout-alternate"]').should('have.attr', 'rel', 'alternate');
        for (const [name, value] of Object.entries({hreflang: 'en-US', charset: 'utf-8', media: 'screen', rev: 'made',
            sizes: 'any', target: '_self', type: 'text/plain', integrity: 'sha256-fixture', crossorigin: 'anonymous', as: 'style', defer: 'defer'})) {
            cy.get('head link[href="https://example.invalid/layout-alternate"]').should('have.attr', name, value);
        }
        cy.get('head link[href$="/fonts/MUI-Icons/MUI-Icons.woff2"]').should('have.attr', 'as', 'font');
        cy.get('head link[href$="/fonts/MUI-Icons/MUI-Icons.woff2"]').should('have.attr', 'crossorigin', 'anonymous');
        cy.get('[data-layout-asset-groups]').should('have.text', 'verified');
        cy.get('head link[href*="/css/layout-"]').should(links => {
            expect([...links].map(link => link.getAttribute('href').split('/').pop())).to.deep.equal(['layout-head.css', 'layout-second.css']);
        });
        cy.get('head').invoke('html').should('contain', '<!--[if lt IE 9]>');
        cy.window().then(win => expect(typeof win.magelensConditionalAsset).to.equal('undefined'));
        cy.visit('/coverageprobe/handle/?variant=selected');
        cy.get('#layout-wireframe [data-layout-handle="dynamic"]').should('have.length', 1).and('have.text', 'dynamic');
        cy.visit('/coverageprobe/fragment/');
        cy.get('#layout-fragment [data-layout-structure="fragment-marker"]').should('have.text', 'fragment-marker');
        cy.get('title').should('not.exist');
        cy.visit('/coverageprobe/anonymous/');
        cy.get('#layout-anonymous [data-layout-anonymous]').should('have.text', 'verified');
        cy.get('[data-layout-order]').then(elements => {
            expect([...elements].map(element => element.textContent)).to.deep.equal(['order.first', 'order.last', 'order.middle']);
        });
        cy.visit('/coverageprobe/component/');
        cy.get('#layout-component .entry-edit').should('have.attr', 'data-bind', "scope: 'magelens_layout_ui.areas'");
        cy.get('[data-layout-ui-proof]').should('have.text', 'verified');
        cy.visit('/coverageprobe/grammar/');
        cy.get('[data-layout-grammar="serviceurl"]').should('have.text', 'applied');
        cy.get('[data-layout-grammar="const"]').should('have.text', 'applied');
        cy.get('[data-layout-grammar="configurable"]').should('have.text', 'generator-error');
        cy.get('[data-layout-grammar="configuredarray"]').should('have.text', 'nested-interpreter-error');
        cy.get('[data-layout-grammar="constarray"]').should('have.text', 'applied');
        for (const entry of ['configureddata', 'configuredvaluearray']) {
            cy.get(`[data-layout-grammar="${entry}"]`).should('have.text', 'applied');
        }
        cy.get('[data-layout-grammar="constenum"]').should('have.text', 'structure-serialization-error');
        for (const entry of ['updaterenabled', 'updaterorder']) {
            cy.get(`[data-layout-grammar="${entry}"]`).should('have.text', 'updater-lookup-error');
        }
        for (const entry of ['cachefalse', 'cacheremoved', 'cachezero']) {
            cy.get(`[data-layout-grammar="${entry}"]`).should('have.text', 'verified');
        }
        cy.visit('/coverageprobe/boundary/');
        cy.get('[data-layout-boundary-failure]').should('have.text', 'verified');
        cy.get('[data-layout-boundary-success]').should('have.text', 'success-value');
        cy.visit('/coverageprobe/classclear/');
        cy.title().should('equal', 'Class reset fixture');
        cy.get('[data-layout-structure="class-clear"]').should('have.text', 'class-clear');
        cy.get('body').should('not.have.class', 'class-before').and('not.have.class', 'class-after');
        cy.visit('/coverageprobe/theme/?___store=default');
        cy.get('#layout-theme [data-layout-structure]').should(markers => {
            expect([...markers].map(marker => marker.textContent).sort()).to.deep.equal(['provider.base.overlay-template',
                'provider.frontend', 'provider.overlay', 'provider.replaced-base', 'provider.replaced-empty']);
        });
        cy.visit('/coverageprobe/theme/?___store=magelens_layout_fixture');
        cy.get('#layout-theme [data-layout-structure]').should(markers => {
            expect([...markers].map(marker => marker.textContent).sort()).to.deep.equal(['provider.base-replacement',
                'provider.base.overlay-template', 'provider.child', 'provider.frontend', 'provider.overlay',
                'provider.parent', 'provider.parent-replacement']);
        });
        cy.get('[data-layout-structure="provider.inactive"], [data-layout-structure="provider.replaced-empty"]').should('not.exist');
        admin.login();
        for (const entry of ['acl-dashboard', 'acl-blog', 'acl-alias']) {
            cy.get(`[data-layout-structure="${entry}"]`).should('have.text', entry);
        }
        cy.visit('/');
        cy.clearCookies();
        const fixture = admin.fixtures();
        admin.login(fixture.readerUser, fixture.readerPassword);
        cy.get('[data-layout-structure="acl-dashboard"]').should('have.text', 'acl-dashboard');
        cy.get('[data-layout-structure="acl-blog"], [data-layout-structure="acl-alias"]').should('not.exist');
    });
});
