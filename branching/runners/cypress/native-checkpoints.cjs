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

function reportedTests(spec, result) {
    const occurrences = new Map(), identify = require('./native-support.cjs').identity;
    return (result?.tests ?? []).map(test => {
        const key = JSON.stringify(test.title), occurrence = occurrences.get(key) ?? 0;
        occurrences.set(key,occurrence + 1);
        return {test, node: identify(spec.absolute,test.title,occurrence)};
    });
}

async function install(collect, config, events, tasks, options) {
    const preparationStarted = performance.now();
    const {manifest, module: modulePath, selected, consumers, identities = {}, declaredSkips = [], linear = false} = options.checkpoint;
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
    const observedEnds = new Map(), retryFailures = new Map();
    const consumerByNode = new Map(Object.entries(identities).map(([consumer,node]) => [node,consumer]));
    let session, cdp, state, initialized, startupMs = 0;
    function recordFailure(node, status) {
        const consumer = consumerByNode.get(node);
        if (status === 'failed' && consumer && session?.active?.consumer === consumer) session.interruptPrefix();
    }
    let ready = false;
    collect('task', {'magelens:observations': batch => {
        if (!Array.isArray(batch) || batch.some(event => !['run-ready', 'spec-start', 'spec-end', 'test-retry'].includes(event.type)))
            throw new Error('Invalid native observation batch');
        for (const {type, ...data} of batch) {
            if (type === 'test-retry') {
                const {node,attempt,message} = data;
                if (typeof node !== 'string' || !Number.isSafeInteger(attempt) || attempt < 0 || typeof message !== 'string')
                    throw new Error('Invalid Cypress retry observation');
                retryFailures.set(JSON.stringify([node,attempt]), {node,attempt,message});
                recordFailure(node, 'failed');
                continue;
            }
            if (type === 'run-ready') {
                if (ready) continue;
                ready = true;
                for (const node of unverified) journal.emit('checkpoint-ineligible', {node, reason:'unverified-restoration'});
            }
            if (type === 'spec-end') {
                observedEnds.set(data.node, data.attempt);
                recordFailure(data.node, data.status);
            }
            journal.emit(type, data);
        }
        return null;
    }});
    // Cypress publishes the last browser-side test event after root after hooks.
    // Reconcile that tail from the actual spec result, without polling or replay.
    collect('after:spec', (spec, result) => {
        for (const {test,node} of reportedTests(spec,result)) {
            recordFailure(node, test.state);
            const attempt = Math.max(0, (test.attempts?.length ?? 0) - 1);
            // A flushed failure from an earlier attempt does not close the retry.
            if (observedEnds.get(node) !== attempt) {
                const status = test.state === 'pending' ? 'skipped' : attempt > 0 ? 'failed' : test.state;
                journal.emit('spec-end', {node, attempt, status, ms: test.duration});
            }
            observedEnds.delete(node);
        }
    });
    let preparationMs, latestLaunch, connectedLaunch, connectedSpec;
    let currentSpec = 0;
    if (candidates.length) collect('before:spec', () => { currentSpec++; });
    const bridge = candidates.length ? await new Bridge({onBoundary: async message => {
        initialized ??= (async () => {
            const started = performance.now();
            connectedLaunch = latestLaunch ?? await bridge.browser;
            connectedSpec = currentSpec;
            cdp = await Cdp.connect(connectedLaunch.port);
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
        if (currentSpec !== connectedSpec || (latestLaunch && latestLaunch !== connectedLaunch)) {
            const started = performance.now();
            const launch = latestLaunch ?? connectedLaunch;
            const spec = currentSpec;
            const next = await Cdp.connect(launch.port);
            try { await state.reconnect(next); }
            catch (error) { next.close(); throw error; }
            cdp = next;
            connectedLaunch = launch;
            connectedSpec = spec;
            session.lifecycleMs += performance.now() - started;
        }
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
        latestLaunch = {port, version: browser.version};
        bridge.resolveBrowser(latestLaunch); return launch;
    });
    collect('after:run', async result => {
        try {
            const tests = (result.runs ?? []).flatMap(run=>reportedTests(run.spec,run));
            const pending = tests.filter(({test})=>test.state==='pending');
            // Cypress reports static .skip declarations as pending. A
            // runtime skip, missing test or executed retry cannot satisfy the
            // exact declaration identities captured before execution.
            const expected = new Set(declaredSkips);
            const declared = pending.length === expected.size && pending.every(({node,test})=>
                expected.delete(node) && !test.attempts?.some(attempt=>attempt.state!=='pending'||attempt.error)) &&
                !expected.size && (result.totalPending ?? 0)===pending.length;
            const retried = tests.filter(({test})=>test.attempts?.length>1).length;
            const passed = !result.totalFailed && !result.totalSkipped && declared && !retried && !retryFailures.size;
            let report;
            if (session) {
                report = await session.close({passed});
                session.economics.observe('backendMs', startupMs + session.lifecycleMs, null);
            } else {
                verifySources(manifest);
                const errors = candidates.length ? [{phase: 'prefix', message: 'Native checkpoint callbacks did not execute'}] : [];
                report = {run, checkpoints: [], restores: [], prefixes: [], decisions: [], observations: [], errors,
                    cleanup: {storageReleased: true}, status: passed && !errors.length ? 'passed' : 'failed'};
            }
            if (declared && declaredSkips.length) report.declaredSkips = pending.map(({node})=>node);
            if (!declared || result.totalSkipped) report.errors.push({phase:'skips',
                message:'Original Cypress pending or skipped tests changed from the verified declarations'});
            if (retryFailures.size) report.retries = [...retryFailures.values()];
            if (retried) report.errors.push({phase: 'retry', message: 'Original Cypress run contains retried tests', tests: retried});
            fs.writeFileSync(path.join(options.directory, 'checkpoints.json'), JSON.stringify(report), {mode: 0o600});
        } finally { cdp?.close(); await bridge?.close(); await journal.close(); }
    });
    preparationMs = performance.now() - preparationStarted;
    return {support: require.resolve('./native-boundary.cjs'),
        browserState: extension.browserState ? path.resolve(path.dirname(extensionFile), extension.browserState) : null};
}
module.exports = {install};
