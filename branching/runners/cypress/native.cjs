// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process');
const {fileDigest} = require('../../identity.cjs');
async function invoke(configuration, directory, {list = false, tests, spec, expectedSpecOrder, profile, checkpoint, onEvent, observationRun} = {}) {
    if (checkpoint && list) throw new Error('Native checkpoint execution cannot be used for collection');
    if (profile && !list) throw new Error('ML profiling was removed; source discovery is list-only');
    if (tests && (!tests.length || new Set(tests.map(test => test.id)).size !== tests.length)) throw new Error('Native Cypress needs a nonempty, unique selection');
    if (spec !== undefined && ((!checkpoint && tests) || !Array.isArray(spec) || !spec.length ||
        spec.some(pattern=>typeof pattern!=='string' || !pattern.trim())))
        throw new Error('Cypress native spec selectors must be a nonempty list and cannot filter individual tests');
    if (expectedSpecOrder !== undefined && (!checkpoint || !Array.isArray(expectedSpecOrder) || !expectedSpecOrder.length ||
        new Set(expectedSpecOrder).size !== expectedSpecOrder.length ||
        expectedSpecOrder.some(file => typeof file !== 'string' || !path.isAbsolute(file))))
        throw new Error('Native Cypress execution requires a unique absolute spec order from discovery');
    const selectedSpecs = tests && [...new Set(tests.map(test => test.file))];
    if (checkpoint && tests && (selectedSpecs.some(file => !path.isAbsolute(file)) ||
        (expectedSpecOrder && JSON.stringify(expectedSpecOrder) !== JSON.stringify(selectedSpecs)) ||
        (spec && JSON.stringify(spec) !== JSON.stringify(selectedSpecs))))
        throw new Error('Selected Cypress tests do not match the discovered spec order');
    const config = fs.realpathSync(configuration);
    const configDigest = profile ? fileDigest(config) : null;
    fs.mkdirSync(directory, {recursive: true});
    const run = fs.mkdtempSync(path.join(directory, 'cypress-'));
    const wrapper = path.join(path.dirname(config), `.magelens-native-${path.basename(run)}.cjs`);
    const observation = onEvent ? await require('./native-observation.cjs').listen(onEvent, observationRun) : null;
    const orderFailure = expectedSpecOrder ? path.join(run, 'spec-order-change.json') : undefined;
    const files = {metadata: path.join(run, 'config.json'), inventory: path.join(run, 'inventory.json'), support: path.join(run, 'support.cjs'), directory: run, list, profile, checkpoint, observation: observation?.endpoint, originalConfig: config, configDigest, expectedSpecOrder, orderFailure, selected: tests?.map(test => test.id)};
    const retryOverride = checkpoint || list ? '' : 'retries: 0, ';
    fs.writeFileSync(wrapper, `const loaded = require(${JSON.stringify(config)});\nconst c = loaded.default ?? loaded;\nmodule.exports = {...c, ${retryOverride}e2e: {...c.e2e, ${retryOverride}setupNodeEvents: (on,config) => require(${JSON.stringify(path.join(__dirname, 'native-plugin.cjs'))}).install(on,config,c.e2e?.setupNodeEvents,${JSON.stringify(files)})}};\n`, {mode: 0o600, flag: 'wx'});
    const resultFile = path.join(run, 'result.json'), input = path.join(run, 'input.json');
    fs.writeFileSync(input, JSON.stringify({resultFile, options: {project: path.dirname(config), configFile: wrapper, browser: 'chrome-for-testing', headed: true,
        ...((spec ?? selectedSpecs) ? {spec: spec ?? selectedSpecs} : {})}}), {mode: 0o600});
    const started = performance.now(), env = {...process.env};
    if (env.DISPLAY === ':99' && !fs.existsSync('/tmp/.X11-unix/X99')) delete env.DISPLAY;
    try {
        const child = spawn(process.execPath, [path.join(__dirname, 'native-worker.cjs'), input], {env, cwd: path.dirname(config), stdio: 'inherit'});
        const signals = ['SIGINT', 'SIGTERM'], handlers = signals.map(signal => () => child.kill(signal));
        signals.forEach((signal, index) => process.on(signal, handlers[index]));
        let exitCode;
        try { exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143))); }); }
        finally { signals.forEach((signal, index) => process.removeListener(signal, handlers[index])); }
        if (orderFailure && fs.existsSync(orderFailure))
            throw new Error('Native Cypress spec order changed after discovery');
        if (!fs.existsSync(resultFile)) throw new Error(`Cypress exited ${exitCode} without a runner result`);
        const result = JSON.parse(fs.readFileSync(resultFile));
        if (!result.browserName && result.failures) throw new Error(result.message ?? 'Cypress failed before producing a browser result');
        if (!fs.existsSync(files.inventory)) throw new Error(`Cypress exited ${exitCode} without a complete inventory report`);
        const inventories = JSON.parse(fs.readFileSync(files.inventory));
        if (result.browserName !== 'chrome-for-testing' || result.browserVersion !== process.env.CHROME_VERSION) throw new Error('Native Cypress browser changed');
        const inventory = inventories.flatMap(item => item.tests), results = [];
        const selected = tests ? inventory.filter(test => files.selected.includes(test.id)) : inventory;
        if (tests && selected.length !== tests.length) throw new Error('Native Cypress selection does not match the discovered inventory');
        for (const spec of result.runs ?? []) {
            const occurrences = new Map();
            for (const test of spec.tests) {
                const key = JSON.stringify(test.title), occurrence = occurrences.get(key) ?? 0;
                occurrences.set(key, occurrence + 1);
                // Filtering registrations changes result indices, but must not
                // renumber duplicate titles in the original native inventory.
                const match = selected.filter(item => item.file === spec.spec.absolute && JSON.stringify(item.titlePath) === key)[occurrence];
                if (!match) throw new Error('Native Cypress result does not match the selected inventory');
                const id = match.id;
                results.push({id, ...testResult(test)});
            }
        }
        const errors = reportErrors(result, inventories);
        const status = exitCode === 0 && !errors.length && results.length === selected.length && results.every(test => ['passed', 'skipped'].includes(test.status)) ? 'passed' : 'failed';
        const report = {schemaVersion: 1, config: JSON.parse(fs.readFileSync(files.metadata)), tests: tests ? inventory.filter(test => files.selected.includes(test.id)) : inventory,
            results: list ? [] : results, specOrder: (result.runs ?? []).map(run => run.spec.absolute), status, errors, exitCode, wallMs: performance.now() - started, reportFile: resultFile,
            browser: {name: result.browserName, version: result.browserVersion}};
        if (profile && fileDigest(config) !== configDigest) throw new Error('Cypress configuration changed during collection');
        if (profile && list) report.profileDiscovery = {directory:run, configDigest};
        if (checkpoint) {
            const evidence = path.join(run, 'checkpoints.json');
            if (!fs.existsSync(evidence)) throw new Error('Native checkpoint report is missing');
            report.checkpoints = JSON.parse(fs.readFileSync(evidence));
            const byId = new Map(results.map(result => [result.id,result]));
            for (const {node,attempt,message} of report.checkpoints.retries ?? []) {
                const result = byId.get(node);
                if (result && !result.errors.some(error => error.message === message))
                    result.errors.push({attempt,message});
            }
            if (report.checkpoints.status !== 'passed') {
                report.status = 'failed';
                report.exitCode ||= 1;
            }
        }
        return report;
    } finally { await observation?.close(); fs.rmSync(wrapper, {force: true}); fs.rmSync(files.support, {force: true}); }
}
function reportErrors(result, inventories) {
    const errors = inventories.flatMap(item => item.errors.map(message => ({message})));
    if (result.failures) errors.push({message: result.message ?? 'Cypress failed before test completion'});
    for (const run of result.runs ?? []) {
        if (run.error) errors.push({file: run.spec?.absolute,
            message: typeof run.error === 'string' ? run.error : run.error.message ?? 'Cypress spec preparation failed'});
    }
    return errors;
}
function testResult(test) {
    const errors = test.attempts.flatMap(attempt => attempt.error ? [attempt.error] : []);
    if (test.displayError && !errors.length) errors.push({message: test.displayError});
    return {status: test.state === 'pending' ? 'skipped' : test.state,
        durationMs: test.duration ?? test.attempts.reduce((sum, attempt) => sum + (attempt.wallClockDuration ?? attempt.duration ?? 0), 0),
        attempts: test.attempts.length, errors};
}
module.exports = {collect: (config, directory, {spec} = {}) => invoke(config, directory, {list: true, spec}), run: invoke, testResult, reportErrors};
