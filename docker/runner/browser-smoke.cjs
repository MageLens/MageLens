// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runnerRequire = require('node:module').createRequire('/workspace/package.json');

async function main() {
    if (process.env.MAGELENS_RUNNER === 'playwright') {
        const browser = await runnerRequire('@playwright/test').chromium.launch({channel: 'chrome', headless: false});
        try {
            const page = await browser.newPage();
            await page.setContent('<title>Desktop check</title><h1>Chrome recovered</h1>');
            assert.equal(await page.title(), 'Desktop check');
            assert.equal(await page.locator('h1').innerText(), 'Chrome recovered');
            console.log(`Recovered Chrome ${browser.version()}`);
        } finally { await browser.close(); }
        return;
    }
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-browser-recovery-'));
    try {
        fs.writeFileSync(path.join(project, 'cypress.config.cjs'), `module.exports = ${JSON.stringify({
            video: false, retries: 0, e2e: {supportFile: false, specPattern: 'recovery.cy.js'}
        })};`);
        fs.writeFileSync(path.join(project, 'index.html'), '<title>Desktop check</title><h1>Chrome recovered</h1>');
        fs.writeFileSync(path.join(project, 'recovery.cy.js'), `it('recovers the visible Chrome browser', () => {
            cy.visit('index.html'); cy.title().should('equal', 'Desktop check'); cy.contains('h1', 'Chrome recovered');
        });`);
        const results = await runnerRequire('cypress').run({project, browser: 'chrome-for-testing', headed: true});
        assert.equal(results.browserName, 'chrome-for-testing');
        assert.equal(results.totalTests, 1);
        assert.equal(results.totalPassed, 1);
        for (const count of ['totalFailed', 'totalPending', 'totalSkipped']) assert.equal(results[count], 0);
        assert.ok(!results.failures);
        console.log(`Recovered Chrome for Testing ${results.browserVersion}`);
    } finally { fs.rmSync(project, {recursive: true, force: true}); }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
