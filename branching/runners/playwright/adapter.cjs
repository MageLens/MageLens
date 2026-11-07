// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

async function open(environment = process.env) {
    const {chromium} = require('@playwright/test');
    const version = require('@playwright/test/package.json').version;
    if (version !== environment.PLAYWRIGHT_VERSION) throw new Error('Installed Playwright does not match dependencies.yaml');
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    if (browser.version() !== environment.CHROME_VERSION) { await browser.close(); throw new Error('Chrome for Testing does not match dependencies.yaml'); }
    const {runBranches} = require('../../../playwright/branching.cjs');
    return {
        description: {name: 'Chrome for Testing', version: browser.version(), playwright: version},
        run: options => runBranches({...options, browser, baseURL: environment.PLAYWRIGHT_BASE_URL, contextOptions: {ignoreHTTPSErrors: true}}),
        close: () => browser.close()
    };
}
module.exports = {open};
