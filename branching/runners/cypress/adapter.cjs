// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {Bridge} = require('./bridge.cjs');
const {Cdp} = require('./cdp.cjs');
const {CypressState} = require('./browser.cjs');

async function open(environment = process.env, {nativeConfig, config = {e2e: {supportFile: false}}, ...extra} = {}) {
    if (Object.keys(extra).length) throw new Error('Unsupported Cypress branching runner option');
    if (nativeConfig) { const loaded = require(path.resolve(nativeConfig)); config = loaded.default ?? loaded; }
    if (config.e2e?.supportFile !== false || config.e2e?.setupNodeEvents || config.e2e?.testIsolation === false) throw new Error('Cypress checkpoint execution requires test isolation and a configuration without support hooks or Node plugin state');
    config = JSON.parse(JSON.stringify(config, (_key, value) => {
        if (['function', 'symbol', 'bigint'].includes(typeof value) || value && typeof value === 'object' && ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value)))
            throw new Error('Cypress checkpoint configuration must contain JSON values');
        return value;
    }));
    if (require('cypress/package.json').version !== environment.CYPRESS_VERSION) throw new Error('Installed Cypress does not match dependencies.yaml');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cypress-queue-'));
    const bridge = await new Bridge().listen();
    const configuration = path.join(directory, 'cypress.config.cjs');
    const options = path.join(directory, 'options.json');
    fs.writeFileSync(configuration, `module.exports = ${JSON.stringify({...config, video: false, retries: 0, e2e: {...config.e2e, supportFile: false, specPattern: path.join(__dirname, 'dispatcher.cy.js'), baseUrl: config.e2e?.baseUrl ?? environment.CYPRESS_BASE_URL}})};\nmodule.exports.e2e.setupNodeEvents = require(${JSON.stringify(path.join(__dirname, 'plugin.cjs'))});\n`, {mode: 0o600});
    fs.writeFileSync(options, JSON.stringify({project: nativeConfig ? path.dirname(path.resolve(nativeConfig)) : directory, configFile: configuration, browser: 'chrome-for-testing', headed: true}), {mode: 0o600});
    const env = {...environment, MAGELENS_CYPRESS_BRIDGE: JSON.stringify({url: bridge.url, token: bridge.token, chromeVersion: environment.CHROME_VERSION})};
    // Cypress owns the disposable Xvfb process when the driver has no desktop.
    if (!fs.existsSync('/tmp/.X11-unix/X99') && env.DISPLAY === ':99') delete env.DISPLAY;
    const worker = spawn(process.execPath, [path.join(__dirname, 'worker.cjs'), options], {env, stdio: 'inherit'});
    let closing = false, state, cdp;
    const done = new Promise((resolve, reject) => {
        worker.once('error', error => { bridge.fail(error); reject(error); });
        worker.once('exit', (code, signal) => {
            if (!closing || code !== 0) { const error = new Error(`Cypress queue exited ${code ?? signal}`); bridge.fail(error); reject(error); }
            else resolve();
        });
    });
    done.catch(() => {});
    async function close() {
        if (closing) return;
        closing = true;
        try {
            await state?.close();
            bridge.queue.push({operation: 'close'}); bridge.flush();
            const timer = setTimeout(() => worker.kill('SIGTERM'), 30000);
            try { await done; } finally { clearTimeout(timer); }
        } finally { cdp?.close(); await bridge.close(); fs.rmSync(directory, {recursive: true, force: true}); }
    }
    try {
        const launched = await bridge.browser;
        cdp = await Cdp.connect(launched.port); await bridge.ready;
        state = new CypressState(bridge, cdp); await state.initialize();
        const description = {name: 'Chrome for Testing', version: launched.version, cypress: environment.CYPRESS_VERSION};
        const provider = (backend, readState) => {
            const Provider = backend.retainsServices ? require('../../retained-provider.cjs').RetainedProvider : require('../../provider.cjs').BranchingProvider;
            const instance = new Provider({browser: {version: () => launched.version}, browserState: state, backend, state: readState});
            instance.workload = 'cypress-workflow';
            instance.identity.cypress = require('../../identity.cjs').implementationDigest([__filename, require.resolve('./browser.cjs'), require.resolve('./dispatcher.cy.js'), require.resolve('./cdp.cjs'), require.resolve('./bridge.cjs')]);
            instance.executeCypress = code => state.execute(code);
            return instance;
        };
        return {description, state, close,
            run: options => require('../../engine.cjs').execute({...options, provider: provider(options.backend, options.state)}),
            calibrate: ({backend, root, samples}) => require('../../calibration.cjs').measure({root, samples,
                provider: provider(backend, runtime => ({url: runtime.page.url(), database: runtime.sql('SELECT 1')})),
                warmup: async () => { await state.execute(`cy.visit(${JSON.stringify(config.e2e?.baseUrl ?? environment.CYPRESS_BASE_URL)}); cy.get('body').should('exist');`); }})};
    } catch (error) { worker.kill('SIGTERM'); try { await close(); } catch { /* Preserve the startup failure. */ } throw error; }
}
module.exports = {open, native: require('./native.cjs')};
