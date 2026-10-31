// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {defineConfig} = require('@playwright/test');
const {specPatterns} = require('./bin/project.cjs');
module.exports = defineConfig({
    testDir: '.',
    testMatch: specPatterns('playwright'),
    testIgnore: ['**/node_modules/**', '**/.runtime/**'],
    workers: 1,
    retries: 0,
    forbidOnly: true,
    timeout: 90000,
    expect: {timeout: 15000},
    reporter: [['list'], ['./playwright/reporter.cjs']],
    outputDir: 'coverage/playwright-artifacts',
    use: {
        browserName: 'chromium',
        baseURL: process.env.PLAYWRIGHT_BASE_URL || process.env.CYPRESS_BASE_URL || 'https://magelens.test',
        ignoreHTTPSErrors: true,
        viewport: {width: 1100, height: 900},
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        headless: false
    }
});
