const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const {createCoverageMap} = require('istanbul-lib-coverage');
const {withTemplateCoverage} = require('@vitaliiboiko/magento-template-coverage/playwright');
const playwright = require('@playwright/test');
const {disablePageTransitions} = require('../bin/browser-navigation.cjs');
function withCoverage(base = playwright.test) {
    return withTemplateCoverage(base, {outputDir: 'coverage/raw/templates'}).extend({
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
        context: async ({context, baseURL}, use) => {
            const run = JSON.parse(fs.readFileSync('coverage/run.json'));
            await context.addInitScript(disablePageTransitions);
            await context.addCookies([{name: 'application_coverage', value: run.id,
                domain: new URL(baseURL).hostname, path: '/', sameSite: 'Lax', httpOnly: true, secure: true}]);
            const snapshots = new Map();
            const binding = '__magelensJS' + randomUUID().replaceAll('-', '');
            await context.exposeBinding(binding, (_source, snapshot) => snapshots.set(snapshot.id, snapshot.coverage));
            await context.addInitScript(({binding}) => {
                const id = crypto.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);
                const publish = () => window[binding]({id, coverage: window.__coverage__ || {}});
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
                const coverage = createCoverageMap({});
                for (const snapshot of snapshots.values()) coverage.merge(snapshot);
                fs.mkdirSync('.nyc_output', {recursive: true});
                fs.writeFileSync(`.nyc_output/playwright-${randomUUID()}.json`, JSON.stringify(coverage));
            }
        }
    });
}
module.exports = {withCoverage, test: withCoverage(), expect: playwright.expect};
