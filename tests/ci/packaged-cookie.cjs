// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const fs = require('node:fs');
const cypress = require('/workspace/node_modules/cypress');
cypress.run({project: '/workspace', configFile: 'tests/ci/cookie-diagnosis-config.cjs',
    browser: 'chrome-for-testing', headed: true, config: {screenshotsFolder: '/evidence/screenshots'}}).then(result => {
    const evidence = Object.fromEntries(['browserName', 'browserVersion', 'cypressVersion', 'totalTests', 'totalPassed', 'totalFailed', 'totalPending', 'totalSkipped'].map(key => [key, result[key]]));
    evidence.build = JSON.parse(fs.readFileSync('/opt/cypress/16.2.1/Cypress/magelens-build.json'));
    evidence.tests = result.runs?.flatMap(run => run.tests.map(test => ({title: test.title, state: test.state, error: test.displayError})));
    fs.writeFileSync('/evidence/results.json', JSON.stringify(evidence, null, 2));
    if (result.totalTests !== 9 || result.totalPassed !== 9 || result.totalFailed !== 0 || result.totalPending !== 0 || result.totalSkipped !== 0 || result.failures) process.exitCode = 1;
}).catch(error => {console.error(error); process.exitCode = 1;});
