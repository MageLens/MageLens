// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
module.exports = {
  video: false,
  retries: 0,
  pageLoadTimeout: 20000,
  e2e: {
    baseUrl: 'http://localhost:8123',
    supportFile: false,
    specPattern: 'tests/ci/cookie-diagnosis.cy.js',
    setupNodeEvents(on) {
      on('after:run', results => {
        if (process.env.COOKIE_RESULT_PATH) {
          require('node:fs').writeFileSync(process.env.COOKIE_RESULT_PATH, JSON.stringify(
            Object.fromEntries(['browserName', 'browserVersion', 'cypressVersion', 'totalTests', 'totalPassed', 'totalFailed', 'totalPending', 'totalSkipped']
              .map(key => [key, results[key]]))));
        }
      });
    }
  }
};
