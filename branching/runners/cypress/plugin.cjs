// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

module.exports = function install(on, configuration) {
    const {url, token, chromeVersion} = JSON.parse(process.env.MAGELENS_CYPRESS_BRIDGE);
    const send = async (route, value) => {
        const response = await fetch(url + route, {method: 'POST', headers: {authorization: token, 'content-type': 'application/json'}, body: JSON.stringify(value), signal: AbortSignal.timeout(180000)});
        if (!response.ok) throw new Error(`Cypress bridge failed: HTTP ${response.status}`);
        return response.json();
    };
    on('task', {'magelens:next': message => send('/next', message)});
    on('before:browser:launch', async (browser, options) => {
        if (browser.name !== 'chrome-for-testing' || browser.version !== chromeVersion) throw new Error('Cypress requires the pinned Chrome for Testing');
        const port = Number(options.args.find(arg => arg.startsWith('--remote-debugging-port='))?.split('=')[1]);
        if (!Number.isInteger(port) || port < 1) throw new Error('Cypress did not provide a Chrome debugging port');
        await send('/browser', {name: browser.name, version: browser.version, port});
        return options;
    });
    return configuration;
};
