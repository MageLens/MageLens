// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createCoverageMap} = require('istanbul-lib-coverage');
const {withTemplateCoverage} = require('@magelens/magento-template-coverage/playwright');
const playwright = require('@playwright/test');
const {disablePageTransitions, installPlaywrightAdminDependencies, observeAdminMenuNavigation} = require('../bin/browser-navigation.cjs');
const {captureHtml} = require('../bin/html-validation.cjs');
const {recordXmlBrowserEvidence} = require('../bin/xml-browser-evidence.cjs');
const {installUiBrowserObserver} = require('../bin/xml-ui-browser.cjs');
const {loadUiBrowserScope} = require('../bin/xml-ui-browser-scope.cjs');
function withCoverage(base = playwright.test) {
    return withTemplateCoverage(base, {outputDir: 'coverage/raw/templates'}).extend({
        recordXmlBrowserEvidence: async ({}, use) => { await use(recordXmlBrowserEvidence); },
        browserIdentity: [async ({browser}, use, testInfo) => {
            testInfo.annotations.push({type: 'magelens-browser', description: JSON.stringify({
                name: testInfo.project.use.channel, version: browser.version()
            })});
            await use();
        }, {auto: true}],
        applicationErrors: [async ({context}, use) => {
            const errors = [];
            const record = error => errors.push(error.message);
            const track = page => page.on('pageerror', record);
            context.on('page', track);
            for (const page of context.pages()) track(page);
            try { await use(); }
            finally {
                context.off('page', track);
                for (const page of context.pages()) page.off('pageerror', record);
                playwright.expect(errors, 'Uncaught application errors').toEqual([]);
            }
        }, {auto: true}],
        // Captures the HTML source of the page's current URL for the validation report; see docs/coverage.md#html-validation.
        mageLensValidateHtml: async ({}, use, testInfo) => {
            await use(async page => {
                // A capture problem must not fail the test that requested the audit.
                try {
                    const url = page.url();
                    const capture = {runner: 'playwright', url, spec: path.relative(testInfo.config.rootDir, testInfo.file),
                        test: testInfo.titlePath.slice(1).join(' › ')};
                    try {
                        const response = await page.request.get(url, {headers: {accept: 'text/html'}, maxRedirects: 0, timeout: 60000});
                        captureHtml({...capture, status: response.status(), contentType: response.headers()['content-type'], html: await response.text()});
                    } catch (error) {
                        captureHtml({...capture, error: error.message.split('\n')[0]});
                    }
                } catch (error) {
                    console.error('HTML validation capture failed:', error.message);
                }
            });
        },
        context: async ({context, baseURL}, use) => {
            const checkAdminDependencies = await installPlaywrightAdminDependencies(context);
            const run = JSON.parse(fs.readFileSync('coverage/run.json'));
            await context.addInitScript(disablePageTransitions);
            await context.addInitScript(installUiBrowserObserver, loadUiBrowserScope(run.id));
            const menuBinding = '__magelensMenu' + randomUUID().replaceAll('-', '');
            await context.exposeBinding(menuBinding, (_source, evidence) => { recordXmlBrowserEvidence(evidence); });
            await context.addInitScript({content:
                `if (window === window.top && location.origin === ${JSON.stringify(new URL(baseURL).origin)}) {
                    (${observeAdminMenuNavigation})(window, () => '${menuBinding}', window.${menuBinding});
                }`});
            await context.addCookies([{name: 'application_coverage', value: run.id,
                domain: new URL(baseURL).hostname, path: '/', sameSite: 'Lax', httpOnly: true, secure: true}]);
            const snapshots = new Map();
            const uiCandidates = new Map();
            const binding = '__magelensJS' + randomUUID().replaceAll('-', '');
            await context.exposeBinding(binding, (_source, snapshot) => {
                snapshots.set(snapshot.id, snapshot.coverage);
                for (const entry of snapshot.ui) uiCandidates.set(JSON.stringify(entry), entry);
            });
            await context.addInitScript(({binding}) => {
                const id = crypto.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);
                const publish = () => window[binding]({id, coverage: window.__coverage__ || {},
                    ui: window.__mageLensUiEffects?.snapshot() ?? []});
                window[binding + '_flush'] = publish;
                setInterval(() => publish().catch(() => {}), 250);
                addEventListener('pagehide', () => publish().catch(() => {}));
            }, {binding});
            const flush = async page => {
                for (const frame of page.frames()) {
                    try { await frame.evaluate(key => window[key]?.(), binding + '_flush'); }
                    catch (error) { if (!/closed|detached|destroyed|navigation/i.test(error.message)) throw error; }
                }
            };
            const closeMethods = new Map();
            const track = page => {
                const close = page.close;
                closeMethods.set(page, close);
                page.close = async function (...args) { await flush(page); return close.apply(this, args); };
            };
            context.on('page', track);
            for (const page of context.pages()) track(page);
            try { await use(context); }
            finally {
                for (const page of context.pages()) await flush(page);
                context.off('page', track);
                for (const [page, close] of closeMethods) page.close = close;
                for (const entry of uiCandidates.values()) recordXmlBrowserEvidence({...entry, candidate: true});
                const coverage = createCoverageMap({});
                for (const snapshot of snapshots.values()) coverage.merge(snapshot);
                fs.mkdirSync('.nyc_output', {recursive: true});
                fs.writeFileSync(`.nyc_output/playwright-${randomUUID()}.json`, JSON.stringify(coverage));
                checkAdminDependencies();
            }
        }
    });
}
module.exports = {withCoverage, test: withCoverage(), expect: playwright.expect};
