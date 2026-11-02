// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {startFixture} = require('./fixtures/cypress-cookies/server.cjs');
const {provenance, source} = require('/opt/magelens/cypress-source/provenance.cjs');
async function main() {
    const fixture = await startFixture();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cypress-cookies-'));
    const output = path.resolve('coverage/cypress-cookie-results.json');
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.rmSync(output, {force: true});
    try {
        fs.copyFileSync(path.join(__dirname, 'fixtures/cypress-cookies/cookies.cy.js'), path.join(project, 'cookies.cy.js'));
        fs.writeFileSync(path.join(project, 'cypress.config.cjs'), 'module.exports = ' + JSON.stringify({
            video: false, retries: 0, pageLoadTimeout: 20000,
            screenshotsFolder: path.resolve('coverage/cypress-cookie-screenshots'),
            env: {authorizationOrigin: fixture.authorizationOrigin},
            e2e: {supportFile: false, specPattern: 'cookies.cy.js'}
        }));
        const build = JSON.parse(fs.readFileSync(`/opt/cypress/${source.version}/Cypress/magelens-build.json`));
        assert.deepEqual(build, provenance(), 'Stale or missing Cypress source fix');
        const result = await require('cypress').run({project, browser: 'chrome-for-testing', headed: true,
            config: {baseUrl: fixture.baseUrl}});
        const report = {...Object.fromEntries(['browserName', 'browserVersion', 'cypressVersion',
            'totalTests', 'totalPassed', 'totalFailed', 'totalPending', 'totalSkipped'].map(key => [key, result[key]])), build};
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
        assert.equal(result.totalTests, 9);
        assert.equal(result.totalPassed, 9);
        assert.equal(result.totalFailed, 0);
        assert.equal(result.totalPending, 0);
        assert.equal(result.totalSkipped, 0);
        assert.ok(!result.failures);
        assert.equal(result.cypressVersion, source.version);
        console.log(`PASS: 9/9 native cookie and authorization regressions: ${output}`);
    } finally {
        await fixture.close();
        fs.rmSync(project, {recursive: true, force: true});
    }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
