// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {spawn} = require('node:child_process');
async function invoke(configuration, directory, {list = false, tests, setup = true, teardown = true, profile} = {}) {
    if (require('playwright/package.json').version !== '1.65.0') throw new Error('Native execution requires the pinned Playwright 1.65.0');
    const config = fs.realpathSync(configuration);
    fs.mkdirSync(directory, {recursive: true});
    const token = randomUUID(), reportFile = path.join(directory, `${token}.json`);
    const timing = profile && !list ? {...profile, runner:'playwright', directory:path.join(directory, `${token}-timing`)} : null;
    // Keep relative config paths relative to the user's original config. The
    // temporary wrapper is hidden, never changes test bytes, and is removed.
    const wrapper = path.join(path.dirname(config), `.magelens-native-${token}.cjs`);
    const selection = path.join(directory, `${token}.tests.txt`);
    if (tests?.some(test => /[\r\n]/.test(test.selector))) throw new Error('Multiline test titles need a native selector encoding');
    if (tests && !tests.length) throw new Error('Native execution needs a nonempty selection');
    fs.writeFileSync(wrapper, `const loaded = require(${JSON.stringify(config)});\nconst c = loaded.default ?? loaded;\nconst reporters = typeof c.reporter === 'string' ? [[c.reporter]] : c.reporter ?? [];\nmodule.exports = {...c, reporter: [...reporters, [${JSON.stringify(path.join(__dirname, 'native-reporter.cjs'))}]], ${setup ? '' : 'globalSetup: undefined,'} ${teardown ? '' : 'globalTeardown: undefined,'}};\n`, {mode: 0o600, flag: 'wx'});
    const args = [path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'), 'test',
        '--config', wrapper, '--workers', '1', '--retries', '0', '--forbid-only'];
    if (list) args.push('--list');
    if (tests) { fs.writeFileSync(selection, tests.map(test => test.selector).join('\n') + '\n', {mode: 0o600}); args.push('--test-list', selection, '--no-deps'); }
    const started = performance.now();
    try {
        const child = spawn(process.execPath, args, {cwd: path.dirname(config), env: {...process.env, MAGELENS_NATIVE_REPORT: reportFile,
            MAGELENS_NATIVE_PROFILE:timing ? JSON.stringify(timing) : ''}, stdio: 'inherit'});
        const signals = ['SIGINT', 'SIGTERM'];
        const forward = signal => child.kill(signal);
        const handlers = signals.map(signal => () => forward(signal));
        signals.forEach((signal, index) => process.on(signal, handlers[index]));
        let code;
        try { code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (status, signal) => resolve(status ?? (signal === 'SIGINT' ? 130 : 143))); }); }
        finally { signals.forEach((signal, index) => process.removeListener(signal, handlers[index])); }
        if (!fs.existsSync(reportFile)) throw new Error(`Playwright exited ${code} without an inventory/result report`);
        const report = JSON.parse(fs.readFileSync(reportFile));
        const uid = Number(process.env.MAGELENS_HOST_UID), gid = Number(process.env.MAGELENS_HOST_GID);
        if (Number.isInteger(uid) && Number.isInteger(gid)) fs.chownSync(reportFile, uid, gid);
        return {...report, exitCode: code, wallMs: performance.now() - started, reportFile};
    } finally { fs.unlinkSync(wrapper); if (fs.existsSync(selection)) fs.unlinkSync(selection); }
}
module.exports = {collect: (config, directory) => invoke(config, directory, {list: true}), run: invoke};
