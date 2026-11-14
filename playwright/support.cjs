// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {coverageCookie} = require('./coverage-cookie.cjs');
const {collectJavaScriptCoverage} = require('./javascript-coverage.cjs');
const {withTemplateCoverage} = require('@vitaliiboiko/magento-template-coverage/playwright');
const playwright = require('@playwright/test');
const {disablePageTransitions} = require('../bin/browser-navigation.cjs');
function withCoverage(base = playwright.test) {
    const root = process.env.MAGELENS_PLAYWRIGHT_COVERAGE_ROOT ?? '.';
    return withTemplateCoverage(base, {outputDir: path.join(root, 'coverage/raw/templates')}).extend({
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
            const run = JSON.parse(fs.readFileSync(path.join(root, 'coverage/run.json')));
            await context.addInitScript(disablePageTransitions);
            await context.addCookies([coverageCookie(baseURL, run.id)]);
            const {finish} = await collectJavaScriptCoverage(context, {directory: path.join(root, '.nyc_output')});
            try { await use(context); }
            finally { await finish(); }
        }
    });
}
exports.withCoverage = withCoverage;
exports.test = withCoverage();
exports.expect = playwright.expect;
