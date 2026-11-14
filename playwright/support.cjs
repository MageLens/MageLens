// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {collectJavaScriptCoverage} = require('./javascript-coverage.cjs');
const {withTemplateCoverage} = require('@vitaliiboiko/magento-template-coverage/playwright');
const playwright = require('@playwright/test');
const {disablePageTransitions} = require('../bin/browser-navigation.cjs');
function withCoverage(base = playwright.test) {
    return withTemplateCoverage(base, {outputDir: 'coverage/raw/templates'}).extend({
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
        context: async ({context, baseURL}, use) => {
            const run = JSON.parse(fs.readFileSync('coverage/run.json'));
            await context.addInitScript(disablePageTransitions);
            await context.addCookies([{name: 'application_coverage', value: run.id,
                domain: new URL(baseURL).hostname, path: '/', sameSite: 'Lax', httpOnly: true, secure: true}]);
            const {finish} = await collectJavaScriptCoverage(context);
            try { await use(context); }
            finally { await finish(); }
        }
    });
}
module.exports = {withCoverage, test: withCoverage(), expect: playwright.expect};
