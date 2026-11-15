// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {Bridge} = require('./bridge.cjs');
const {Cdp} = require('./cdp.cjs');
const {CypressState} = require('./browser.cjs');
const {NativeSession} = require('./native-session.cjs');
const {verifySources} = require('../../automatic.cjs');
const domains = ['application', 'browser', 'filesystem', 'cache', 'queues', 'search', 'contracts', 'runner', 'plugins', 'coverage'];

async function install(collect, config, events, tasks, options) {
    const preparationStarted = performance.now();
    const {manifest, module: modulePath, selected, consumers, linear = false} = options.checkpoint;
    const extensionFile = path.resolve(modulePath);
    const extensionDigest = require('../../identity.cjs').fileDigest(extensionFile);
    const extension = require(extensionFile);
    const browserState = extension.browserState ? path.resolve(path.dirname(extensionFile), extension.browserState) : null;
    const stateAccess = (extension.stateAccess ?? []).map(entry=>({...entry,file:path.resolve(path.dirname(extensionFile),entry.file)}));
    const extensionFiles = [extensionFile, ...(extension.files ?? []), ...stateAccess.map(entry=>entry.file), ...(extension.browserState ? [extension.browserState] : [])]
        .map(file => path.resolve(path.dirname(extensionFile), file));
    const extensionSources = extensionFiles.map(file => [file, require('../../identity.cjs').fileDigest(file)]);
    const plan = require('./native-plan.cjs').prepare(manifest, selected, consumers);
    if (typeof extension.assess !== 'function' || typeof extension.createProvider !== 'function')
        throw new Error('Native checkpoint restoration assessment and provider are required');
    // An assessment is bound to exact source and boundary identities. Presence
    // of support files or plugins is neither blanket rejection nor permission.
    const assessment = await extension.assess({manifest, plan, config, tasks: Object.keys(tasks)});
    const unverified = [];
    for (const candidate of plan.candidates) {
        const evidence = assessment?.find(item => item.identity === candidate.identity);
        if (!evidence || domains.some(domain => !['restored', 'unchanged', 'absent'].includes(evidence.domains?.[domain])) ||
            evidence.continuation !== 'equivalent') unverified.push(candidate.id);
    }
    const candidates = plan.candidates.filter(candidate => !unverified.includes(candidate.id));
    const entries = plan.entries.filter(entry => !unverified.includes(entry.checkpoint));
    const preprocessors = events.get('file:preprocessor') ?? [];
    if (entries.length && preprocessors.length) {
        if (preprocessors.length !== 1 || typeof extension.instrumentPreprocessor !== 'function')
            throw new Error('The original Cypress preprocessor needs a checkpoint transform integration');
        events.set('file:preprocessor', [await extension.instrumentPreprocessor(preprocessors[0], entries, {browserState, stateAccess})]);
    } else if (entries.length) {
        // This is the pinned Cypress default compiler, including its plugins and
        // source maps. Add one pre-loader; do not replace the module graph.
        const compiler = require(`/opt/cypress/${process.env.CYPRESS_VERSION}/Cypress/resources/app/node_modules/@cypress/webpack-batteries-included-preprocessor`);
        const webpackOptions = compiler.getFullWebpackOptions();
        webpackOptions.module.rules.unshift({enforce: 'pre', include: [...new Set([...entries.map(entry => entry.file), ...stateAccess.map(entry=>entry.file)])],
            use: [{loader: require.resolve('./native-loader.cjs'), options: {entries, browserState, stateAccess}}]});
        collect('file:preprocessor', compiler({webpackOptions}));
    }
    const directory = path.join(options.directory, 'checkpoints'); fs.mkdirSync(directory, {mode: 0o700});
    const run = options.observation?.run ?? randomUUID();
    const journal = require('../../events.cjs').events({run, directory: path.join(options.directory, 'events'),
        onEvent: options.observation ? async event => {
            const response = await fetch(options.observation.url, {method: 'POST', headers: {authorization: options.observation.token},
                body: JSON.stringify(event), signal: AbortSignal.timeout(10000)});
            if (!response.ok) throw new Error('Native observation delivery failed');
        } : extension.emit ? event => extension.emit(event.type, event) : undefined});
    const observedEnds = new Set();
    let ready = false;
    collect('task', {'magelens:observations': batch => {
        if (!Array.isArray(batch) || batch.some(event => !['run-ready', 'spec-start', 'spec-end'].includes(event.type)))
            throw new Error('Invalid native observation batch');
        for (const {type, ...data} of batch) {
            if (type === 'run-ready') {
                if (ready) continue;
                ready = true;
                for (const node of unverified) journal.emit('checkpoint-ineligible', {node, reason:'unverified-restoration'});
            }
            if (type === 'spec-end') observedEnds.add(data.node);
            journal.emit(type, data);
        }
        return null;
    }});
    // Cypress publishes the last browser-side test event after root after hooks.
    // Reconcile that tail from the actual spec result, without polling or replay.
    collect('after:spec', (spec, result) => {
        const occurrences = new Map();
        for (const test of result?.tests ?? []) {
            const key = JSON.stringify(test.title), occurrence = occurrences.get(key) ?? 0;
            occurrences.set(key, occurrence + 1);
            const node = require('./native-support.cjs').identity(spec.absolute, test.title, occurrence);
            if (!observedEnds.has(node)) {
                observedEnds.add(node);
                journal.emit('spec-end', {node, status: test.state === 'pending' ? 'skipped' : test.state, ms: test.duration});
            }
        }
    });
    let session, cdp, state, initialized, startupMs = 0;
    let preparationMs;
    const bridge = candidates.length ? await new Bridge({onBoundary: async message => {
        initialized ??= (async () => {
            const started = performance.now();
            const launched = await bridge.browser;
            cdp = await Cdp.connect(launched.port);
            state = new CypressState(bridge, cdp); await state.initialize();
            const provider = await extension.createProvider({config, state, tasks, directory, assessment});
            startupMs = preparationMs + performance.now() - started;
            session = new NativeSession({plan:candidates, provider, directory,
                run, bridge, verifySources: () => {
                    verifySources(manifest);
                    if (require('../../identity.cjs').fileDigest(extensionFile) !== extensionDigest) throw new Error('Native restoration implementation changed');
                    for (const [file, expected] of extensionSources)
                        if (require('../../identity.cjs').fileDigest(file) !== expected) throw new Error('Native restoration dependency changed');
                },
                emit: journal.emit, baseline: extension.baseline, statistics: extension.statistics, linear});
        })();
        await initialized;
        await session.boundary(message);
    }}).listen() : null;
    if (bridge) collect('task', {'magelens:next': async message => {
        const response = await fetch(bridge.url + '/next', {method: 'POST', headers: {authorization: bridge.token},
            body: JSON.stringify(message), signal: AbortSignal.timeout(180000)});
        if (!response.ok) throw new Error('Native Cypress checkpoint transport failed');
        return response.json();
    }});
    if (bridge) collect('before:browser:launch', (browser, launch) => {
        const port = Number(launch.args.find(argument => argument.startsWith('--remote-debugging-port='))?.split('=')[1]);
        if (browser.name !== 'chrome-for-testing' || browser.version !== process.env.CHROME_VERSION || !Number.isInteger(port) || port < 1)
            throw new Error('Native checkpoints require pinned Chrome for Testing and its debugging port');
        bridge.resolveBrowser({port, version: browser.version}); return launch;
    });
    collect('after:run', async result => {
        try {
            const passed = !result.totalFailed && !result.totalSkipped && !result.totalPending;
            let report;
            if (session) {
                const started = performance.now();
                report = await session.close({passed});
                session.economics.observe('backendMs', startupMs + session.lifecycleMs + performance.now() - started, null);
            } else {
                verifySources(manifest);
                const errors = candidates.length ? [{phase: 'prefix', message: 'Native checkpoint callbacks did not execute'}] : [];
                report = {run, checkpoints: [], restores: [], prefixes: [], decisions: [], observations: [], errors,
                    cleanup: {storageReleased: true}, status: passed && !errors.length ? 'passed' : 'failed'};
            }
            fs.writeFileSync(path.join(options.directory, 'checkpoints.json'), JSON.stringify(report), {mode: 0o600});
        } finally { cdp?.close(); await bridge?.close(); await journal.close(); }
    });
    preparationMs = performance.now() - preparationStarted;
    return {support: require.resolve('./native-boundary.cjs'),
        browserState: extension.browserState ? path.resolve(path.dirname(extensionFile), extension.browserState) : null};
}
module.exports = {install};
