// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
async function install(on, config, original, options) {
    const events = new Map(), tasks = {};
    const collect = (name, callback) => {
        if (options.list && ['before:run', 'after:run', 'before:spec', 'after:spec'].includes(name)) return;
        if (name === 'task') {
            for (const [key, task] of Object.entries(callback)) { if (key in tasks) throw new Error(`Duplicate Cypress task: ${key}`); tasks[key] = task; }
        } else { if (!events.has(name)) events.set(name, []); events.get(name).push(callback); }
    };
    const hasNodeEvents = typeof original === 'function';
    if (hasNodeEvents) config = await original(collect, config) ?? config;
    const supportFile = config.supportFile;
    const discoveryBaseUrl = options.list ? config.baseUrl : undefined;
    if (options.list) config.baseUrl = null;
    const native = {projects: [{name: 'cypress', dependencies: []}], rootDir: config.projectRoot,
        unassessedLifecycle: [...(supportFile ? ['Cypress support-file hooks and command registrations'] : []),
            ...(hasNodeEvents ? ['Cypress setupNodeEvents and plugin lifecycle'] : [])],
        checkpointLifecycle: !supportFile && !hasNodeEvents && config.testIsolation !== false ? 'independent-cypress' : 'native-cypress'};
    fs.writeFileSync(options.metadata, JSON.stringify(native), {mode: 0o600});
    fs.writeFileSync(options.support, `require(${JSON.stringify(path.join(__dirname, 'native-support.cjs'))}).install(${JSON.stringify({list: options.list, selected: options.selected, profile: !!options.profile, discoveryBaseUrl})});\n${supportFile ? `require(${JSON.stringify(supportFile)});` : ''}\n`, {mode: 0o600});
    config.supportFile = options.support;
    config.screenshotsFolder = path.join(options.directory, 'screenshots'); config.videosFolder = path.join(options.directory, 'videos');
    collect('task', {'magelens:inventory': value => {
        const inventories = fs.existsSync(options.inventory) ? JSON.parse(fs.readFileSync(options.inventory)) : [];
        if (inventories.some(item => item.file === value.file)) throw new Error('Duplicate Cypress spec inventory');
        inventories.push(value); fs.writeFileSync(options.inventory, JSON.stringify(inventories), {mode: 0o600}); return null;
    }});
    if (options.profile && !options.list) collect('task', {'magelens:timing:prepare':
        require('../../predictor/native.cjs').collector(options.profile,options.directory,config.projectRoot)});
    collect('before:browser:launch', (browser, launch) => {
        if (browser.name !== 'chrome-for-testing' || browser.version !== process.env.CHROME_VERSION) throw new Error('Native Cypress requires pinned Chrome for Testing');
        return launch;
    });
    on('task', tasks);
    for (const [name, callbacks] of events) {
        if (name === 'file:preprocessor' && callbacks.length !== 1) throw new Error('Multiple Cypress preprocessors');
        on(name, async (...args) => {
            let result;
            for (const callback of callbacks) {
                const next = await callback(...args);
                if (next !== undefined) { result = next; if (name === 'before:browser:launch') args[1] = next; }
            }
            return result;
        });
    }
    return config;
}
module.exports = {install};
