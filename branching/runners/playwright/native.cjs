// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {spawn} = require('node:child_process');
const {fileDigest} = require('../../identity.cjs');
async function invoke(configuration, directory, {list = false, tests, setup = true, teardown = true, profile, onPrepared} = {}) {
    if (onPrepared && (!profile || list)) throw new Error('Preparation callback requires a profiled Playwright run');
    if (require('playwright/package.json').version !== '1.65.0') throw new Error('Native execution requires the pinned Playwright 1.65.0');
    const config = fs.realpathSync(configuration);
    directory = path.resolve(directory);
    fs.mkdirSync(directory, {recursive: true});
    const token = randomUUID(), reportFile = path.join(directory, `${token}.json`);
    const timing = profile ? {...profile, runner:'playwright', discoveryOnly:list,
        directory:path.join(directory, `${token}-timing`), configDigest:fileDigest(config)} : null;
    // Keep relative config paths relative to the user's original config. The
    // temporary wrapper is hidden, never changes test bytes, and is removed.
    const wrapper = path.join(path.dirname(config), `.magelens-native-${token}.cjs`);
    const selection = path.join(directory, `${token}.tests.txt`);
    if (tests?.some(test => /[\r\n]/.test(test.selector))) throw new Error('Multiline test titles need a native selector encoding');
    if (tests && !tests.length) throw new Error('Native execution needs a nonempty selection');
    fs.writeFileSync(wrapper, `const loaded = require(${JSON.stringify(config)});\nconst c = loaded.default ?? loaded;\nconst reporters = process.env.MAGELENS_NATIVE_LIST === '1' ? [] : typeof c.reporter === 'string' ? [[c.reporter]] : c.reporter ?? [];\nmodule.exports = {...c, reporter: [...reporters, [${JSON.stringify(path.join(__dirname, 'native-reporter.cjs'))}]], ${setup ? '' : 'globalSetup: undefined,'} ${teardown ? '' : 'globalTeardown: undefined,'}};\n`, {mode: 0o600, flag: 'wx'});
    const args = [path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'), 'test',
        '--config', wrapper, '--workers', '1', '--retries', '0', '--forbid-only'];
    const started = performance.now();
    async function launch({listing, prepare, output}) {
        const child = spawn(process.execPath, listing ? [...args, '--list'] : args, {cwd: path.dirname(config),
            env: {...process.env, MAGELENS_NATIVE_REPORT:output, MAGELENS_NATIVE_LIST:listing ? '1' : '',
                MAGELENS_NATIVE_PREPARE:prepare ? '1' : '0', MAGELENS_NATIVE_PROFILE:timing ? JSON.stringify(timing) : ''},
            stdio: 'inherit'});
        const signals = ['SIGINT', 'SIGTERM'];
        const forward = signal => child.kill(signal);
        const handlers = signals.map(signal => () => forward(signal));
        signals.forEach((signal, index) => process.on(signal, handlers[index]));
        let code;
        try { code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (status, signal) => resolve(status ?? (signal === 'SIGINT' ? 130 : 143))); }); }
        finally { signals.forEach((signal, index) => process.removeListener(signal, handlers[index])); }
        if (!fs.existsSync(output)) throw new Error(`Playwright exited ${code} without an inventory/result report`);
        return {...JSON.parse(fs.readFileSync(output)), exitCode:code};
    }
    try {
        if (tests) {
            fs.writeFileSync(selection, tests.map(test => test.selector).join('\n') + '\n', {mode: 0o600});
            args.push('--test-list', selection, '--no-deps');
        }
        const forecasts = timing && path.join(timing.directory, 'predictions.json');
        let prepared;
        if (timing && !list) {
            // Reporter exceptions do not stop Playwright from dispatching tests.
            // Prepare in a list-only invocation before allowing a browser run.
            const output = path.join(timing.directory, 'preflight.json');
            fs.mkdirSync(timing.directory, {recursive:true, mode:0o700});
            prepared = await launch({listing:true, prepare:true, output});
            if (prepared.exitCode !== 0 || prepared.status !== 'passed' || prepared.errors.length ||
                !fs.existsSync(forecasts)) {
                throw new Error(`Playwright profile preparation failed: ${prepared.errors.map(error => error.message).join('; ') || prepared.status}`);
            }
            for (const row of JSON.parse(fs.readFileSync(forecasts))) {
                if (row.files.some(({file,hash}) => fileDigest(file) !== hash))
                    throw new Error('Playwright source changed during profile preparation');
            }
        }
        if (timing && fileDigest(config) !== timing.configDigest)
            throw new Error('Playwright configuration changed before execution');
        if (onPrepared) await onPrepared({forecastDigest:fileDigest(forecasts), tests:prepared.tests});
        const report = await launch({listing:list, prepare:list, output:reportFile});
        if (timing && fileDigest(config) !== timing.configDigest)
            throw new Error('Playwright configuration changed during collection');
        const uid = Number(process.env.MAGELENS_HOST_UID), gid = Number(process.env.MAGELENS_HOST_GID);
        if (Number.isInteger(uid) && Number.isInteger(gid)) fs.chownSync(reportFile, uid, gid);
        return {...report, wallMs: performance.now() - started, reportFile,
            ...(timing && !list ? {profileArtifacts:{
                forecasts,
                observations:report.prediction ? path.join(timing.directory, 'prediction-samples.json') : null
            }} : {})};
    } finally { fs.unlinkSync(wrapper); if (fs.existsSync(selection)) fs.unlinkSync(selection); }
}
module.exports = {collect: (config, directory) => invoke(config, directory, {list: true}), run: invoke};
