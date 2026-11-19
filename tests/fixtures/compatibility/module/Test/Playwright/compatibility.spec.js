// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {verifyScriptPolicy} = require('../csp-proof');
const {test, expect} = require('../../../../../../../playwright/support.cjs');
const admin = require('../../../../Application/Blog/Test/Playwright/support');
test('collects real PHP, JavaScript and template execution', async ({page}) => {
    const response = await page.goto('/coverageprobe/');
    for (const marker of ['replacement', 'equal', 'late']) {
        await expect(page.locator(`[data-layout-origin="${marker}"]`)).toHaveText([marker]);
    }
    await expect(page.locator('[data-layout-origin="original"], [data-layout-origin="unvisited"]')).toHaveCount(0);
    if (process.env.MAGELENS_THEME === 'hyva') {
        const policy = response.headers()['content-security-policy'];
        expect(policy).toContain('script-src');
        expect(policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1]).not.toContain("'unsafe-eval'");
        expect(policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1]).not.toContain("'unsafe-inline'");
        const proof = await page.evaluate('(' + verifyScriptPolicy.toString() + ')(document)');
        expect(proof).toEqual({evalBlocked: true, inlineBlocked: true, inlineExecuted: false});
        require('node:fs').writeFileSync('coverage/csp-proof.json', JSON.stringify({theme: 'Hyva/default-csp', runner: 'playwright', ...proof}));
    }
    await expect(page.locator('[data-cy="inline-probe"]')).toHaveText('inline-ready');
    expect(await page.evaluate(() => window.magelensChildScript)).toBe('child-ready');
    await expect(page.locator('[data-cy="probe-count"]')).toHaveText('0');
    await page.locator('[data-cy="probe-increment"]').click();
    await expect(page.locator('[data-cy="probe-count"]')).toHaveText('1');
    await page.getByRole('textbox', {name: 'Probe name'}).fill('coverage');
    await expect(page.locator('[data-cy="probe-echo"]')).toHaveText('coverage');
    await page.locator('[data-cy="probe-save"]').click();
    await expect(page.locator('[data-cy="probe-saved"]')).toHaveText('Saved coverage');
    await expect(page.locator('[data-cy="probe-item"]')).toHaveCount(2);
    await expect(page.locator('[data-cy="probe-never"]')).toHaveCount(0);
    if (process.env.MAGELENS_THEME === 'hyva') {
        expect(await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent('update-gallery-42', {detail: 'gallery-updated'}));
            window.dispatchEvent(new CustomEvent('update-prices-42', {detail: 'price-updated'}));
            const event = new Event('submit', {bubbles: true, cancelable: true});
            document.querySelector('[data-cy="probe-prevented"]').dispatchEvent(event);
            return event.defaultPrevented;
        })).toBe(true);
        await expect(page.locator('[data-cy="probe-image"]')).toHaveText('gallery-updated');
        await expect(page.locator('[data-cy="probe-price"]')).toHaveText('price-updated');
    }
    await page.goto('/customer/account/login/');
    await expect(page.locator('#email')).toBeVisible();
});
test('starts the next test with fresh state', async ({page}) => {
    await page.goto('/coverageprobe/');
    await expect(page.locator('[data-cy="inline-probe"]')).toHaveText('inline-ready');
    expect(await page.evaluate(() => window.magelensChildScript)).toBe('child-ready');
    await expect(page.locator('[data-cy="probe-count"]')).toHaveText('0');
    await expect(page.getByRole('textbox', {name: 'Probe name'})).toHaveValue('initial');
    await page.goto('/coverageprobe/handle/');
    const wireframe = page.locator('#layout-wireframe');
    await expect(wireframe.locator('[data-layout-handle]')).toHaveText(['repeat', 'nested', 'action']);
    await expect(wireframe.locator('[data-layout-registry]')).toHaveText('MageLens fixture wireframe');
    for (const effect of ['membership', 'override', 'equal', 'empty', 'cdata', 'mixed', 'cdata-equal', 'translation-flag', 'page-type', 'page-type-equal']) {
        await expect(wireframe.locator(`[data-layout-registry-effect="${effect}"]`)).toHaveText('verified');
    }
    for (const effect of ['custom', 'wireframe', 'equal', 'filtered', 'available', 'containers']) {
        await expect(wireframe.locator(`[data-layout-handle-metadata="${effect}"]`)).toHaveText('verified');
    }
    for (const effect of ['move', 'removal', 'nested-block', 'ttl', 'cacheable', 'ignored-body']) {
        await expect(wireframe.locator(`[data-layout-wireframe-proof="${effect}"]`)).toHaveText('verified');
    }
    await expect(wireframe.locator('#layout-wireframe-move [data-layout-structure]')).toHaveText('wireframe-move-marker');
    await expect(page.locator('body')).not.toHaveAttribute('data-wireframe-ignored');
    await expect(page.locator('meta[name="magelens-wireframe"]')).toHaveCount(0);
    await expect(wireframe.locator('#layout-left [data-layout-structure]')).toHaveText(['first', 'restored']);
    await expect(wireframe.locator('#layout-right #layout-nested [data-layout-structure]')).toHaveText(['anchor', 'moved']);
    await expect(wireframe.locator('#layout-removed, [data-layout-structure="hidden"]')).toHaveCount(0);
    await expect(wireframe.locator('[data-layout-structure-outcome]')).toHaveText('verified');
    await expect(wireframe.locator('#layout-left')).toHaveClass('layout-effective');
    await expect(wireframe.locator('#layout-empty, #layout-hidden-container, [data-layout-structure="hidden-container-child"]')).toHaveCount(0);
    await expect(wireframe.locator('[data-layout-structure="config-allowed"]')).toHaveText('config-allowed');
    await expect(wireframe.locator('[data-layout-structure="config-denied"]')).toHaveCount(0);
    for (const effect of ['string', 'number', 'boolean', 'null', 'array', 'shared', 'nonshared', 'options',
        'helper', 'url', 'updater', 'text-updater', 'translation', 'actions', 'late-replacement',
        'equal-replacement', 'unset-value', 'offset-replacement', 'offset-read', 'array-path',
        'indexed-array', 'indexed-string', 'literal-slash']) {
        await expect(wireframe.locator(`[data-layout-argument="${effect}"]`)).toHaveText('verified');
    }
    await expect(page).toHaveTitle('Effective fixture title');
    for (const element of ['html', 'head', 'body']) {
        await expect(page.locator(element)).toHaveAttribute(`data-layout-${element}`, 'fixture');
    }
    await expect(page.locator('body')).toHaveClass(/\blayout-head-fixture\b/);
    await expect(page.locator('body')).toHaveClass(/\bpage-wide\b/);
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute('content', 'Effective fixture description');
    await expect(page.locator('head meta[name="magelens-layout"]')).toHaveAttribute('content', 'fixture metadata');
    const ignoredMetadata = page.locator('head meta[name="magelens-ignored-attributes"]');
    await expect(ignoredMetadata).toHaveAttribute('content', 'native-content');
    for (const attribute of ['http-equiv', 'charset', 'scheme']) {
        expect(await ignoredMetadata.getAttribute(attribute)).toBeNull();
    }
    await expect(page.locator('meta[http-equiv="X-MageLens-Fixture"], meta[charset="utf-16"]')).toHaveCount(0);
    await expect(page.locator('head meta[name="magelens-replaced"]')).toHaveAttribute('content', 'same');
    await expect(page.locator('body')).toHaveAttribute('data-layout-replaced', 'same');
    await expect(page.locator('head link[href*="/css/layout-head.css"]')).toHaveAttribute('media', 'screen');
    await expect(page.locator('head link[href*="/css/layout-removed.css"], head link[href*="/css/layout-absent.css"]')).toHaveCount(0);
    await expect(page.locator('head script[src*="/js/layout-head.js"]')).toHaveAttribute('defer', 'defer');
    await expect(page.locator('head script[src*="/js/layout-head.js"]')).toHaveAttribute('async', 'async');
    await expect(page.locator('head link[href="https://example.invalid/layout-alternate"]')).toHaveAttribute('rel', 'alternate');
    for (const [name, value] of Object.entries({hreflang: 'en-US', charset: 'utf-8', media: 'screen', rev: 'made',
        sizes: 'any', target: '_self', type: 'text/plain', integrity: 'sha256-fixture', crossorigin: 'anonymous', as: 'style', defer: 'defer'})) {
        await expect(page.locator('head link[href="https://example.invalid/layout-alternate"]')).toHaveAttribute(name, value);
    }
    await expect(page.locator('head link[href$="/fonts/MUI-Icons/MUI-Icons.woff2"]')).toHaveAttribute('as', 'font');
    await expect(page.locator('head link[href$="/fonts/MUI-Icons/MUI-Icons.woff2"]')).toHaveAttribute('crossorigin', 'anonymous');
    await expect(page.locator('[data-layout-asset-groups]')).toHaveText('verified');
    const order = await page.locator('head link[href*="/css/layout-"]').evaluateAll(links =>
        links.map(link => link.getAttribute('href').split('/').pop()));
    expect(order).toEqual(['layout-head.css', 'layout-second.css']);
    expect(await page.locator('head').innerHTML()).toContain('<!--[if lt IE 9]>');
    expect(await page.evaluate(() => typeof window.magelensConditionalAsset)).toBe('undefined');
    await page.goto('/coverageprobe/handle/?variant=selected');
    await expect(wireframe.locator('[data-layout-handle="dynamic"]')).toHaveText(['dynamic']);
    await page.goto('/coverageprobe/fragment/');
    await expect(page.locator('#layout-fragment [data-layout-structure="fragment-marker"]')).toHaveText('fragment-marker');
    await expect(page.locator('title')).toHaveCount(0);
    await page.goto('/coverageprobe/generic/');
    await expect(page.locator('[data-layout-generic]')).toHaveText('verified');
    await expect(page.locator('#layout-generic-right [data-layout-structure]')).toHaveText('generic.moved');
    for (const variant of ['after', 'before', 'equal', 'precedence', 'missing', 'destination', 'removed', 'programmatic', 'same', 'unchanged', 'sibling-missing', 'alias-fallback', 'overridden']) {
        await page.goto(`/coverageprobe/moves/?case=${variant}`);
        const expected = variant === 'before' ? ['movable', 'anchor', 'tail']
            : ['equal', 'precedence', 'sibling-missing', 'alias-fallback'].includes(variant) ? ['anchor', 'tail', 'movable']
            : ['missing', 'destination', 'removed', 'same', 'unchanged'].includes(variant) ? ['anchor', 'tail'] : ['anchor', 'movable', 'tail'];
        await expect(page.locator('#moveoperands-right [data-layout-moveoperand]')).toHaveText(expected);
        await expect(page.locator('#moveoperands-left [data-layout-moveoperand]')).toHaveCount(['missing', 'same', 'unchanged'].includes(variant) ? 1 : 0);
        await expect(page.locator('#moveoperands-removed')).toHaveCount(0);
    }
    await page.goto('/coverageprobe/anonymous/');
    await expect(page.locator('#layout-anonymous [data-layout-anonymous]')).toHaveText('verified');
    await expect(page.locator('[data-layout-order]')).toHaveText(['order.first', 'order.last', 'order.middle']);
    await page.goto('/coverageprobe/component/');
    await expect(page.locator('#layout-component .entry-edit[data-bind*="magelens_layout_ui.areas"]')).toHaveAttribute('data-bind', "scope: 'magelens_layout_ui.areas'");
    await expect(page.locator('[data-layout-ui-proof]')).toHaveText('verified');
    for (const effect of ['alias', 'ordering', 'group', 'visibility', 'calls', 'cacheable', 'ttl', 'output']) {
        await expect(page.locator(`[data-layout-ui-effect="${effect}"]`)).toHaveText('verified');
    }
    for (const route of ['conditionmutation', 'readermutation']) {
        await page.goto(`/coverageprobe/${route}/`);
        await expect(page.locator('[data-layout-ui-proof]')).toHaveText('verified');
        await expect(page.locator('[data-layout-ui-effect="calls"]')).toHaveText('verified');
    }
    await page.goto('/coverageprobe/grammar/');
    await expect(page.locator('[data-layout-grammar="serviceurl"], [data-layout-grammar="const"]')).toHaveText(['applied', 'applied']);
    await expect(page.locator('[data-layout-grammar="configurable"]')).toHaveText('generator-error');
    await expect(page.locator('[data-layout-grammar="configuredarray"]')).toHaveText('nested-interpreter-error');
    await expect(page.locator('[data-layout-grammar="constarray"]')).toHaveText('applied');
    await expect(page.locator('[data-layout-grammar="configureddata"], [data-layout-grammar="configuredvaluearray"]')).toHaveText(['applied', 'applied']);
    await expect(page.locator('[data-layout-grammar="constenum"]')).toHaveText('structure-serialization-error');
    for (const variant of ['typeprefix', 'typelocalprefix']) {
        await expect(page.locator(`[data-layout-grammar="${variant}"]`)).toHaveText('type-erased');
    }
    await expect(page.locator('[data-layout-grammar="updaterenabled"], [data-layout-grammar="updaterorder"]')).toHaveText(['updater-lookup-error', 'updater-lookup-error']);
    await expect(page.locator('[data-layout-grammar="cachefalse"], [data-layout-grammar="cacheremoved"], [data-layout-grammar="cachezero"], [data-layout-grammar="uiroot"]')).toHaveText(['verified', 'verified', 'verified', 'verified']);
    await page.goto('/coverageprobe/boundary/');
    await expect(page.locator('[data-layout-boundary-failure]')).toHaveText('verified');
    await expect(page.locator('[data-layout-boundary-success]')).toHaveText('success-value');
    await page.goto('/coverageprobe/mutation/');
    await expect(page.locator('[data-layout-mutation]')).toHaveText(['xml-value', 'php-value', 'xml-value', 'xml-value']);
    await page.goto('/coverageprobe/packagemutation/');
    await expect(page.locator('[data-layout-mutation]')).toHaveText(['xml-value', 'xml-value']);
    await page.goto('/coverageprobe/argumentownership/');
    await expect(page.locator('[data-layout-mutation]')).toHaveText(['xml-value', 'xml-value', 'xml-value']);
    await page.goto('/coverageprobe/templateownership/');
    await expect(page.locator('[data-layout-mutation]')).toHaveText(['xml-value', 'xml-value', 'xml-value', 'xml-value', 'xml-value']);
    await page.goto('/coverageprobe/cache/');
    await expect(page.locator('[data-layout-block-cache]')).toHaveText(['cold-value', 'cold-value']);
    const cacheNonce = Date.now().toString(36);
    const cachedUrl = `/coverageprobe/cachepage/?probe=${cacheNonce}`;
    try {
        const cold = await page.goto(cachedUrl);
        expect(cold.headers()['x-magelens-fixture-cache']).toBe('miss');
        await expect(page.locator('[data-layout-page-cache]')).toHaveText('cached-layout');
        const warm = await page.goto(cachedUrl);
        expect(warm.headers()['x-magelens-fixture-cache']).toBe('hit');
        await expect(page.locator('[data-layout-page-cache]')).toHaveText('cached-layout');
    } finally {
        await page.goto(`/coverageprobe/cachepage/cleanup/?probe=${cacheNonce}`);
        await expect(page.locator('[data-layout-page-cache-cleanup]')).toHaveText('cleaned');
    }
    await page.goto('/coverageprobe/dynamic/');
    await expect(page.locator('[data-layout-dynamic]')).toHaveText(['xml-value', 'xml-value', 'xml-value', 'xml-value']);
    await expect(page.locator('[data-layout-dynamic-nested]')).toHaveText(['xml-value|xml-value', 'xml-value|xml-value', 'xml-value|xml-value', 'xml-value']);
    for (const fixtureCase of ['native', 'equal', 'nested', 'scalar']) {
        await page.goto(`/coverageprobe/database/?case=${fixtureCase}`);
        await expect(page.locator('[data-layout-database]')).toHaveText('xml-value');
        await expect(page.locator('[data-layout-database-nested]')).toHaveText(
            fixtureCase === 'scalar' ? 'xml-value' : 'xml-value|xml-value');
    }
    await page.goto('/coverageprobe/shared/');
    await expect(page.locator('[data-layout-shared]')).toHaveText(['second-value', 'second-value', 'second-value', 'second-value']);
    await expect(page.locator('[data-layout-shared="first"]')).toHaveCount(0);
    await expect(page.locator('[data-layout-shared="second"]')).toHaveCount(4);
    for (const renderPath of ['native', 'direct']) {
        await expect(page.locator(`[data-layout-shared-path="${renderPath}"] [data-layout-shared]`)).toHaveCount(2);
    }
    for (const fixtureCase of ['native', 'inline', 'custom', 'expired']) {
        await page.goto(`/coverageprobe/cms/?case=${fixtureCase}`);
        await expect(page).toHaveTitle('CMS runtime title');
        await expect(page.locator('[data-layout-cms-content]')).toHaveText('CMS fixture body');
        await expect(page.locator('[data-layout-cms="xml"]')).toHaveText('xml-value');
        await expect(page.locator('[data-layout-cms="selected"]')).toHaveText('selected-file');
        const inline = page.locator('[data-layout-cms="inline"]');
        if (fixtureCase === 'native') await expect(inline).toHaveCount(0);
        else {
            await expect(inline).toHaveText(fixtureCase === 'custom' ? 'custom-value' : 'inline-value');
            await expect(inline).toHaveAttribute('data-layout-cms-template', 'xml');
        }
    }
    await page.goto('/coverageprobe/renderfailure/');
    for (const effect of ['empty', 'missing', 'throw', 'after']) {
        await expect(page.locator(`[data-layout-renderfailure="${effect}"]`)).toHaveText('verified');
    }
    await expect(page.locator('[data-layout-renderfailure-output="after"]')).toHaveCount(0);
    for (const nameCase of ['blocks', 'move', 'containers']) {
        await page.goto('/coverageprobe/names/?case=' + nameCase);
        await expect(page.locator('[data-layout-name-proof]')).toHaveText('verified');
        await expect(page.locator('[data-layout-name-stale-roots]')).toHaveAttribute('data-layout-name-stale-roots', '0');
        await expect(page.locator('[data-layout-name-case]')).toHaveCount(nameCase === 'containers' ? 1 : (nameCase === 'move' ? 5 : 4));
        if (nameCase === 'containers') await expect(page.locator('#layout-zero-container [data-layout-name-case="container-child"]')).toHaveText('base');
        else {
            await expect(page.locator('[data-layout-name-render-failed]')).toHaveText('verified');
            await expect(page.locator('#layout-numeric-root')).toHaveCount(0);
            await expect(page.locator('[data-layout-name-case="integer"]')).toHaveText('override');
            for (const name of ['leading', 'zero', 'anonymous']) await expect(page.locator(`[data-layout-name-case="${name}"]`)).toHaveText('base');
            if (nameCase === 'move') await expect(page.locator('[data-layout-name-case="moved"]')).toHaveText('base');
            else await expect(page.locator('[data-layout-name-case="moved"]')).toHaveCount(0);
        }
    }
    await page.goto('/coverageprobe/actionfailure/');
    for (const failureCase of ['body', 'interpreter', 'partial', 'dispatch', 'type', 'denied', 'success']) {
        await expect(page.locator('[data-layout-action-failure="' + failureCase + '"]')).toHaveText('verified');
    }
    for (const sharedCase of ['guarded', 'unguarded', 'distinct']) {
        await page.goto('/coverageprobe/sharedactions/?case=' + sharedCase);
        await expect(page.locator('[data-layout-shared-action-proof]')).toHaveText('verified');
        await expect(page.locator('[data-layout-shared-action-proof]')).toHaveAttribute('data-layout-shared-action-case', sharedCase);
    }
    await page.goto('/coverageprobe/magicactions/');
    await expect(page.locator('[data-layout-magic-action-proof]')).toHaveText('verified');
    await expect(page.locator('[data-layout-magic-action]')).toHaveCount(3);
    for (const [name, marker] of Object.entries({empty: 'empty', zero: 'zero', denied: ''})) {
        await expect(page.locator(`[data-layout-magic-action="magelens.magic.action.${name}"]`)).toHaveText(marker);
    }
    await expect(page.locator('[data-layout-magic-action="magelens.magic.action.unrendered"]')).toHaveCount(0);
    await page.goto('/coverageprobe/actionguards/');
    await expect(page.locator('[data-layout-action-guard-proof]')).toHaveText('verified');
    await expect(page.locator('[data-layout-action-case]')).toHaveCount(6);
    for (const [name, markers] of Object.entries({allowed: 'allowed', denied: '', duplicate: 'first,second', empty: 'empty', zero: 'zero', same: 'same'})) {
        await expect(page.locator(`[data-layout-action-case="magelens.action.guard.${name}"]`)).toHaveText(markers);
    }
    await page.goto('/coverageprobe/falsy/');
    await expect(page.locator('[data-layout-falsy-proof]')).toHaveText('verified');
    expect(await page.locator('[data-layout-falsy]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-layout-falsy'))))
        .toEqual(['native', 'zero', 'empty', 'padded', 'signed', 'override.zero', 'override.empty', 'wrapper.child', 'restored.block', 'restored.child'].map(name => 'magelens.falsy.' + name));
    const zeroClassWrapper = page.locator('[data-layout-falsy="magelens.falsy.wrapper.child"]').locator('..');
    await expect(zeroClassWrapper).toHaveJSProperty('tagName', 'SECTION0');
    expect(await zeroClassWrapper.getAttribute('class')).toBeNull();
    await page.goto('/coverageprobe/references/');
    await expect(page.locator('[data-layout-reference-proof]')).toHaveText('verified');
    await expect(page.locator('#layout-reference-inner')).toHaveClass('reference-effective');
    await expect(page.locator('[data-layout-reference-output="effective"]')).toHaveText('reference-marker/action-marker');
    await expect(page.locator('[data-layout-reference-child]')).toHaveText('attached-child');
    await expect(page.locator('[data-layout-reference-output="base"], #layout-reference-removed, #layout-reference-empty')).toHaveCount(0);
    await page.goto('/coverageprobe/propertyownership/');
    for (const effect of ['native', 'template-get', 'template-set', 'template-magic', 'template-redeclared',
        'data-get', 'data-magic', 'data-set', 'data-redeclared', 'after-failure']) {
        await expect(page.locator(`[data-layout-property="${effect}"]`)).toHaveText('verified');
    }
    await page.goto('/coverageprobe/dependencies/');
    for (const effect of ['native', 'resolver_hook', 'context_hook', 'engine_hook', 'resolver_magic',
        'context_magic', 'engine_magic', 'resolver_redeclared', 'lock_magic', 'lock_shadow']) {
        await expect(page.locator(`[data-layout-dependency="${effect}"]`)).toHaveText('verified');
    }
    await page.goto('/coverageprobe/classclear/');
    await expect(page).toHaveTitle('Class reset fixture');
    await expect(page.locator('[data-layout-structure="class-clear"]')).toHaveText('class-clear');
    await expect(page.locator('body')).not.toHaveClass(/\bclass-(before|after)\b/);
    await page.goto('/coverageprobe/theme/?___store=default');
    const providers = () => page.locator('#layout-theme [data-layout-structure]').allTextContents();
    expect((await providers()).sort()).toEqual(['provider.base.overlay-template', 'provider.frontend',
        'provider.overlay', 'provider.replaced-base', 'provider.replaced-empty']);
    await page.goto('/coverageprobe/theme/?___store=magelens_layout_fixture');
    expect((await providers()).sort()).toEqual(['provider.base-replacement', 'provider.base.overlay-template',
        'provider.child', 'provider.frontend', 'provider.overlay', 'provider.parent', 'provider.parent-replacement']);
    await expect(page.locator('[data-layout-structure="provider.inactive"], [data-layout-structure="provider.replaced-empty"]')).toHaveCount(0);
    await admin.login(page);
    await expect(page.locator('[data-layout-structure="acl-dashboard"]')).toHaveText('acl-dashboard');
    await expect(page.locator('[data-layout-structure="acl-blog"]')).toHaveText('acl-blog');
    await expect(page.locator('[data-layout-structure="acl-alias"]')).toHaveText('acl-alias');
    await expect(page.locator('[data-layout-structure="ui-acl-dashboard"]')).toHaveText('ui-acl-dashboard');
    await expect(page.locator('[data-layout-structure="ui-acl-blog"]')).toHaveText('ui-acl-blog');
    await page.goto('/');
    await page.context().clearCookies();
    const fixture = admin.fixtures();
    await admin.login(page, fixture.readerUser, fixture.readerPassword);
    await expect(page.locator('[data-layout-structure="acl-dashboard"]')).toHaveText('acl-dashboard');
    await expect(page.locator('[data-layout-structure="acl-blog"], [data-layout-structure="acl-alias"]')).toHaveCount(0);
    await expect(page.locator('[data-layout-structure="ui-acl-dashboard"]')).toHaveText('ui-acl-dashboard');
    await expect(page.locator('[data-layout-structure="ui-acl-blog"]')).toHaveCount(0);
});
