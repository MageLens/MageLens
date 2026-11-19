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
        for (const effect of ['membership', 'override', 'equal', 'empty', 'cdata', 'mixed', 'cdata-equal', 'translation-flag', 'page-type', 'page-type-equal']) {
            cy.get(`#layout-wireframe [data-layout-registry-effect="${effect}"]`).should('have.text', 'verified');
        }
        for (const effect of ['custom', 'wireframe', 'equal', 'filtered', 'available', 'containers']) {
            cy.get(`#layout-wireframe [data-layout-handle-metadata="${effect}"]`).should('have.text', 'verified');
        }
        for (const effect of ['move', 'removal', 'nested-block', 'ttl', 'cacheable', 'ignored-body']) {
            cy.get(`#layout-wireframe [data-layout-wireframe-proof="${effect}"]`).should('have.text', 'verified');
        }
        cy.get('#layout-wireframe-move [data-layout-structure]').should('have.text', 'wireframe-move-marker');
        cy.get('body').should('not.have.attr', 'data-wireframe-ignored');
        cy.get('meta[name="magelens-wireframe"]').should('not.exist');
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
        cy.get('head meta[name="magelens-ignored-attributes"]').should('have.attr', 'content', 'native-content');
        for (const attribute of ['http-equiv', 'charset', 'scheme']) {
            cy.get('head meta[name="magelens-ignored-attributes"]').should('not.have.attr', attribute);
        }
        cy.get('meta[http-equiv="X-MageLens-Fixture"], meta[charset="utf-16"]').should('not.exist');
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
        cy.visit('/coverageprobe/generic/');
        cy.get('[data-layout-generic]').should('have.text', 'verified');
        cy.get('#layout-generic-right [data-layout-structure]').should('have.text', 'generic.moved');
        for (const variant of ['after', 'before', 'equal', 'precedence', 'missing', 'destination', 'removed', 'programmatic', 'same', 'unchanged', 'sibling-missing', 'alias-fallback', 'overridden']) {
            cy.visit(`/coverageprobe/moves/?case=${variant}`);
            const expected = variant === 'before' ? ['movable', 'anchor', 'tail']
                : ['equal', 'precedence', 'sibling-missing', 'alias-fallback'].includes(variant) ? ['anchor', 'tail', 'movable']
                : ['missing', 'destination', 'removed', 'same', 'unchanged'].includes(variant) ? ['anchor', 'tail'] : ['anchor', 'movable', 'tail'];
            cy.get('#moveoperands-right [data-layout-moveoperand]').should(elements => {
                expect([...elements].map(element => element.textContent)).to.deep.equal(expected);
            });
            cy.get('#moveoperands-left [data-layout-moveoperand]').should('have.length', ['missing', 'same', 'unchanged'].includes(variant) ? 1 : 0);
            cy.get('#moveoperands-removed').should('not.exist');
        }
        cy.visit('/coverageprobe/anonymous/');
        cy.get('#layout-anonymous [data-layout-anonymous]').should('have.text', 'verified');
        cy.get('[data-layout-order]').then(elements => {
            expect([...elements].map(element => element.textContent)).to.deep.equal(['order.first', 'order.last', 'order.middle']);
        });
        cy.visit('/coverageprobe/component/');
        cy.get('#layout-component .entry-edit[data-bind*="magelens_layout_ui.areas"]').should('have.attr', 'data-bind', "scope: 'magelens_layout_ui.areas'");
        cy.get('[data-layout-ui-proof]').should('have.text', 'verified');
        for (const effect of ['alias', 'ordering', 'group', 'visibility', 'calls', 'cacheable', 'ttl', 'output']) {
            cy.get(`[data-layout-ui-effect="${effect}"]`).should('have.text', 'verified');
        }
        for (const route of ['conditionmutation', 'readermutation']) {
            cy.visit(`/coverageprobe/${route}/`);
            cy.get('[data-layout-ui-proof]').should('have.text', 'verified');
            cy.get('[data-layout-ui-effect="calls"]').should('have.text', 'verified');
        }
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
        for (const variant of ['typeprefix', 'typelocalprefix']) {
            cy.get(`[data-layout-grammar="${variant}"]`).should('have.text', 'type-erased');
        }
        for (const entry of ['updaterenabled', 'updaterorder']) {
            cy.get(`[data-layout-grammar="${entry}"]`).should('have.text', 'updater-lookup-error');
        }
        for (const entry of ['cachefalse', 'cacheremoved', 'cachezero', 'uiroot']) {
            cy.get(`[data-layout-grammar="${entry}"]`).should('have.text', 'verified');
        }
        cy.visit('/coverageprobe/boundary/');
        cy.get('[data-layout-boundary-failure]').should('have.text', 'verified');
        cy.get('[data-layout-boundary-success]').should('have.text', 'success-value');
        cy.visit('/coverageprobe/mutation/');
        cy.get('[data-layout-mutation]').then(elements => {
            expect([...elements].map(element => element.textContent)).to.deep.equal(['xml-value', 'php-value', 'xml-value', 'xml-value']);
        });
        cy.visit('/coverageprobe/packagemutation/');
        cy.get('[data-layout-mutation]').then(elements => {
            expect([...elements].map(element => element.textContent)).to.deep.equal(['xml-value', 'xml-value']);
        });
        cy.visit('/coverageprobe/argumentownership/');
        cy.get('[data-layout-mutation]').then(elements => {
            expect([...elements].map(element => element.textContent)).to.deep.equal(['xml-value', 'xml-value', 'xml-value']);
        });
        cy.visit('/coverageprobe/templateownership/');
        cy.get('[data-layout-mutation]').should('have.length', 5).each(element => {
            cy.wrap(element).should('have.text', 'xml-value');
        });
        cy.visit('/coverageprobe/cache/');
        cy.get('[data-layout-block-cache]').should(elements => {
            expect([...elements].map(element => element.textContent)).to.deep.equal(['cold-value', 'cold-value']);
        });
        const cacheNonce = Date.now().toString(36);
        const cachedUrl = `/coverageprobe/cachepage/?probe=${cacheNonce}`;
        cy.intercept('GET', '**/coverageprobe/cachepage/?probe=*').as('layoutPageCache');
        cy.visit(cachedUrl);
        cy.wait('@layoutPageCache').its('response.headers.x-magelens-fixture-cache').should('equal', 'miss');
        cy.get('[data-layout-page-cache]').should('have.text', 'cached-layout');
        cy.visit(cachedUrl);
        cy.wait('@layoutPageCache').its('response.headers.x-magelens-fixture-cache').should('equal', 'hit');
        cy.get('[data-layout-page-cache]').should('have.text', 'cached-layout');
        cy.visit(`/coverageprobe/cachepage/cleanup/?probe=${cacheNonce}`);
        cy.get('[data-layout-page-cache-cleanup]').should('have.text', 'cleaned');
        cy.visit('/coverageprobe/dynamic/');
        cy.get('[data-layout-dynamic]').should(markers => {
            expect([...markers].map(marker => marker.textContent)).to.deep.equal(['xml-value', 'xml-value', 'xml-value', 'xml-value']);
        });
        cy.get('[data-layout-dynamic-nested]').should(markers => {
            expect([...markers].map(marker => marker.textContent)).to.deep.equal(['xml-value|xml-value', 'xml-value|xml-value', 'xml-value|xml-value', 'xml-value']);
        });
        for (const fixtureCase of ['native', 'equal', 'nested', 'scalar']) {
            cy.visit(`/coverageprobe/database/?case=${fixtureCase}`);
            cy.get('[data-layout-database]').should('have.text', 'xml-value');
            cy.get('[data-layout-database-nested]').should('have.text',
                fixtureCase === 'scalar' ? 'xml-value' : 'xml-value|xml-value');
        }
        cy.visit('/coverageprobe/shared/');
        cy.get('[data-layout-shared]').should(markers => {
            expect([...markers].map(marker => marker.textContent)).to.deep.equal(['second-value', 'second-value', 'second-value', 'second-value']);
        });
        cy.get('[data-layout-shared="first"]').should('not.exist');
        cy.get('[data-layout-shared="second"]').should('have.length', 4);
        for (const renderPath of ['native', 'direct']) {
            cy.get(`[data-layout-shared-path="${renderPath}"] [data-layout-shared]`).should('have.length', 2);
        }
        for (const fixtureCase of ['native', 'inline', 'custom', 'expired']) {
            cy.visit(`/coverageprobe/cms/?case=${fixtureCase}`);
            cy.title().should('equal', 'CMS runtime title');
            cy.get('[data-layout-cms-content]').should('have.text', 'CMS fixture body');
            cy.get('[data-layout-cms="xml"]').should('have.text', 'xml-value');
            cy.get('[data-layout-cms="selected"]').should('have.text', 'selected-file');
            if (fixtureCase === 'native') cy.get('[data-layout-cms="inline"]').should('not.exist');
            else {
                cy.get('[data-layout-cms="inline"]').should('have.text', fixtureCase === 'custom' ? 'custom-value' : 'inline-value')
                    .and('have.attr', 'data-layout-cms-template', 'xml');
            }
        }
        cy.visit('/coverageprobe/renderfailure/');
        for (const effect of ['empty', 'missing', 'throw', 'after']) {
            cy.get(`[data-layout-renderfailure="${effect}"]`).should('have.text', 'verified');
        }
        cy.get('[data-layout-renderfailure-output="after"]').should('not.exist');
        for (const nameCase of ['blocks', 'move', 'containers']) {
            cy.visit('/coverageprobe/names/?case=' + nameCase);
            cy.get('[data-layout-name-proof]').should('have.text', 'verified');
            cy.get('[data-layout-name-stale-roots]').should('have.attr', 'data-layout-name-stale-roots', '0');
            cy.get('[data-layout-name-case]').should('have.length', nameCase === 'containers' ? 1 : (nameCase === 'move' ? 5 : 4));
            if (nameCase === 'containers') cy.get('#layout-zero-container [data-layout-name-case="container-child"]').should('have.text', 'base');
            else {
                cy.get('[data-layout-name-render-failed]').should('have.text', 'verified');
                cy.get('#layout-numeric-root').should('not.exist');
                cy.get('[data-layout-name-case="integer"]').should('have.text', 'override');
                for (const name of ['leading', 'zero', 'anonymous']) cy.get(`[data-layout-name-case="${name}"]`).should('have.text', 'base');
                if (nameCase === 'move') cy.get('[data-layout-name-case="moved"]').should('have.text', 'base');
                else cy.get('[data-layout-name-case="moved"]').should('not.exist');
            }
        }
        cy.visit('/coverageprobe/templatevalues/');
        cy.get('[data-layout-template-value-proof]').should('have.text', 'verified');
        cy.get('[data-layout-template-value]').then(nodes => {
            expect([...nodes].map(node => node.getAttribute('data-layout-template-value')))
                .to.deep.equal(['argument', 'action', 'equal.action', 'equal.argument', 'late.argument', 'late.action', 'default', 'case', 'interceptor', 'direct.attribute', 'direct.argument', 'direct.action'].map(name => 'magelens.template.values.' + name));
        });
        cy.visit('/coverageprobe/nestedarguments/');
        for (const effect of ['shared', 'fresh', 'translate', 'options', 'helper', 'url']) {
            cy.get(`[data-layout-nested-argument="${effect}"]`).should('have.text', 'verified');
        }
        cy.visit('/coverageprobe/opaqueaction/');
        cy.get('[data-layout-opaque-action]').should('have.text', 'verified');
        cy.visit('/coverageprobe/argumentgroups/');
        cy.get('[data-layout-argument-group="block"]').should('have.text', 'first-group');
        cy.get('[data-layout-argument-group="reference"]').should('have.text', 'first-reference-group');
        cy.visit('/coverageprobe/actionfailure/');
        for (const failureCase of ['body', 'interpreter', 'partial', 'dispatch', 'type', 'denied', 'success']) {
            cy.get('[data-layout-action-failure="' + failureCase + '"]').should('have.text', 'verified');
        }
        for (const sharedCase of ['guarded', 'unguarded', 'distinct']) {
            cy.visit('/coverageprobe/sharedactions/?case=' + sharedCase);
            cy.get('[data-layout-shared-action-proof]').should('have.text', 'verified')
                .and('have.attr', 'data-layout-shared-action-case', sharedCase);
        }
        cy.visit('/coverageprobe/magicactions/');
        cy.get('[data-layout-magic-action-proof]').should('have.text', 'verified');
        cy.get('[data-layout-magic-action]').should('have.length', 3);
        for (const [name, marker] of Object.entries({empty: 'empty', zero: 'zero', denied: ''})) {
            cy.get(`[data-layout-magic-action="magelens.magic.action.${name}"]`).should('have.text', marker);
        }
        cy.get('[data-layout-magic-action="magelens.magic.action.unrendered"]').should('not.exist');
        cy.visit('/coverageprobe/actionguards/');
        cy.get('[data-layout-action-guard-proof]').should('have.text', 'verified');
        cy.get('[data-layout-action-case]').should('have.length', 6);
        for (const [name, markers] of Object.entries({allowed: 'allowed', denied: '', duplicate: 'first,second', empty: 'empty', zero: 'zero', same: 'same'})) {
            cy.get(`[data-layout-action-case="magelens.action.guard.${name}"]`).should('have.text', markers);
        }
        cy.visit('/coverageprobe/falsy/');
        cy.get('[data-layout-falsy-proof]').should('have.text', 'verified');
        cy.get('[data-layout-falsy]').then(elements => {
            expect([...elements].map(element => element.getAttribute('data-layout-falsy')))
                .to.deep.equal(['native', 'zero', 'empty', 'padded', 'signed', 'override.zero', 'override.empty', 'wrapper.child', 'restored.block', 'restored.child'].map(name => 'magelens.falsy.' + name));
        });
        cy.get('[data-layout-falsy="magelens.falsy.wrapper.child"]').parent().should(wrapper => {
            expect(wrapper[0].tagName).to.equal('SECTION0');
            expect(wrapper[0].getAttribute('class')).to.equal(null);
        });
        cy.visit('/coverageprobe/references/');
        cy.get('[data-layout-reference-proof]').should('have.text', 'verified');
        cy.get('#layout-reference-inner').should('have.class', 'reference-effective');
        cy.get('[data-layout-reference-output="effective"]').should('have.text', 'reference-marker/action-marker');
        cy.get('[data-layout-reference-child]').should('have.text', 'attached-child');
        cy.get('[data-layout-reference-output="base"], #layout-reference-removed, #layout-reference-empty').should('not.exist');
        cy.visit('/coverageprobe/propertyownership/');
        for (const effect of ['native', 'template-get', 'template-set', 'template-magic', 'template-redeclared',
            'data-get', 'data-magic', 'data-set', 'data-redeclared', 'data-direct', 'after-failure']) {
            cy.get(`[data-layout-property="${effect}"]`).should('have.text', 'verified');
        }
        for (const field of ['template', 'data']) for (const method of ['bind', 'bindTo', 'call']) {
            cy.get(`[data-layout-scoped-field="${field}.${method}"]`).should('have.text', 'verified');
        }
        cy.visit('/coverageprobe/dependencies/');
        for (const effect of ['native', 'resolver_hook', 'context_hook', 'engine_hook', 'resolver_magic',
            'context_magic', 'engine_magic', 'resolver_redeclared', 'lock_magic', 'lock_shadow']) {
            cy.get(`[data-layout-dependency="${effect}"]`).should('have.text', 'verified');
        }
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
        for (const entry of ['acl-dashboard', 'acl-blog', 'acl-alias', 'ui-acl-dashboard', 'ui-acl-blog']) {
            cy.get(`[data-layout-structure="${entry}"]`).should('have.text', entry);
        }
        cy.visit('/');
        cy.clearCookies();
        const fixture = admin.fixtures();
        admin.login(fixture.readerUser, fixture.readerPassword);
        cy.get('[data-layout-structure="acl-dashboard"]').should('have.text', 'acl-dashboard');
        cy.get('[data-layout-structure="acl-blog"], [data-layout-structure="acl-alias"]').should('not.exist');
        cy.get('[data-layout-structure="ui-acl-dashboard"]').should('have.text', 'ui-acl-dashboard');
        cy.get('[data-layout-structure="ui-acl-blog"]').should('not.exist');
    });
});
