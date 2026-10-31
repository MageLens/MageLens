// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const cypress = require('cypress');
const {specPatterns, warmupPaths} = require('./project.cjs');
const warmup = process.argv.includes('--warmup');
const run = JSON.parse(fs.readFileSync('coverage/run.json'));
const projectFixtures = JSON.parse(fs.readFileSync('coverage/project-fixtures.json'));
const expectedSpecs = warmup ? ['cypress/warmup/storefront.cy.js'] : fs.globSync(specPatterns()).sort();
if (!expectedSpecs.length) throw new Error('Add your project tests to cypress/e2e/*.cy.js before running coverage.');
const options = warmup ? {
    expose: {warmup: true, coverageRun: null, projectFixtures, warmupPaths: warmupPaths(projectFixtures)},
    config: {
        specPattern: expectedSpecs, supportFile: 'cypress/support/warmup.js',
        pageLoadTimeout: 180000, defaultCommandTimeout: 180000, responseTimeout: 180000,
        retries: 0, screenshotsFolder: 'coverage/warmup-screenshots'
    }
} : {expose: {warmup: false, coverageRun: run.id, projectFixtures}};
const resultsFile = warmup ? 'coverage/warmup-results.json' : 'coverage/cypress-results.json';
cypress.run({browser: 'electron', headed: true, ...options}).then(results => {
    fs.writeFileSync(resultsFile, JSON.stringify({
        run: run.id, totalTests: results.totalTests, totalPassed: results.totalPassed,
        totalFailed: results.totalFailed, totalPending: results.totalPending,
        totalSkipped: results.totalSkipped, failures: results.failures,
        status: results.status, message: results.message,
        specs: results.runs?.map(result => ({path: result.spec.relative, tests: result.tests.length})),
        tests: results.runs?.flatMap(result => result.tests.map(test => ({title: test.title.at(-1), status: test.state})))
    }, null, 2));
    const actualSpecs = (results.runs || []).map(result => result.spec.relative).sort();
    if (JSON.stringify(actualSpecs) !== JSON.stringify(expectedSpecs) || results.runs?.some(result => !result.tests.length) || results.failures || !(results.totalTests > 0) || results.totalPassed !== results.totalTests || results.totalFailed !== 0 || results.totalPending !== 0 || results.totalSkipped !== 0) {
        throw new Error(warmup
            ? 'Browser warm-up did not pass. Inspect coverage/warmup-results.json, coverage/warmup-diagnostics.json and coverage/warmup-screenshots.'
            : 'The full Cypress suite did not pass. Inspect coverage/cypress-results.json and cypress/screenshots.');
    }
}).catch(error => { console.error(error); process.exitCode = 1; });
