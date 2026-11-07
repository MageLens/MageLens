// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync, execFileSync} = require('node:child_process');
const {describe} = require('../branching/images.cjs');
const {descriptor, loadRunner} = require('../branching/runners/index.cjs');
const {planner} = require('../branching/planner-client.cjs');
const root = path.resolve(__dirname, '..');
function temporary(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens branching '));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    return directory;
}
function copy(directory, file) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), {recursive: true});
    fs.copyFileSync(path.join(root, file), path.join(directory, file));
}
function command(directory, file, source) {
    fs.writeFileSync(path.join(directory, file), source, {mode: 0o755});
}
function launchFixture(t) {
    const directory = temporary(t);
    for (const file of ['bin/run-coverage', 'bin/run-branching']) copy(directory, file);
    for (const file of ['.runtime', 'cow storage', 'commands']) fs.mkdirSync(path.join(directory, file));
    fs.writeFileSync(path.join(directory, '.runtime/installed'), '5');
    fs.writeFileSync(path.join(directory, 'workflow file.cjs'), 'module.exports = {};');
    fs.writeFileSync(path.join(directory, 'manifest.json'), '{}');
    fs.writeFileSync(path.join(directory, 'bin/common'), `set -euo pipefail
ROOT=$PWD
export MAGELENS_RUNNER=\${TEST_RUNNER:-playwright} LOCAL_UID=1000 LOCAL_GID=1000 PLAYWRIGHT_VERSION=1.65.0 CHROME_VERSION=156.0.8078.80
fail() { echo "$*" >&2; exit 1; }
preflight() { :; }
dc() { echo runner; }
`);
    command(directory, 'bin/branching-image', '#!/bin/sh\nprintf "image:%s\\n" "$*" >> "$MOCK_LOG"\necho "fixture-$1"\n');
    command(directory, 'commands/docker', `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'info') console.log('linux');
if (args[0] === 'inspect') {
    if (args[2].includes('NetworkSettings')) console.log('fixture-network');
    else if (args[2].includes('Mounts')) console.log('type=volume,source=modules,target=/workspace/node_modules,readonly');
    else console.log('PLAYWRIGHT_BASE_URL=http://fixture.test');
}
if (args[0] === 'run' && args.includes('--detach')) console.log('a'.repeat(64));
if (args[0] === 'exec' && process.env.TEST_VERIFY_FAIL === '1') process.exit(23);
if (args[0] === 'run' && args.includes('node')) process.exit(37);
`);
    const log = path.join(directory, 'calls');
    return {directory, run: (args, env = {}) => {
        fs.writeFileSync(log, '');
        const result = spawnSync('bash', args, {cwd: directory, encoding: 'utf8', env: {...process.env,
            PATH: `${directory}/commands:${process.env.PATH}`, MOCK_LOG: log, ...env}});
        return {...result, calls: fs.readFileSync(log, 'utf8')};
    }};
}
test('branching opt-in preserves literal arguments, worker status and controller cleanup', t => {
    const {directory, run} = launchFixture(t);
    const result = run(['bin/run-coverage', '--disposable', 'manifest.json', 'workflow file.cjs', 'cow storage', '--branching']);
    assert.equal(result.status, 37, result.stderr);
    const calls = result.calls.split('\n').filter(line => line.startsWith('[')).map(JSON.parse);
    const worker = calls.find(args => args.includes('node'));
    assert.deepEqual(worker.slice(-4), ['branching/auto-cli.cjs', path.join(directory, 'manifest.json'), path.join(directory, 'workflow file.cjs'), path.join(directory, 'cow storage')]);
    assert.ok(worker.includes('MAGELENS_ORCHESTRATOR_CONTAINER=' + 'a'.repeat(64)));
    assert.ok(worker.includes('type=volume,source=modules,target=/workspace/node_modules,readonly'));
    assert.deepEqual(calls.at(-1), ['rm', '--force', 'a'.repeat(64)]);
});
test('direct entry requires opt-in; help and unsupported adapter do not start containers', t => {
    const {run} = launchFixture(t);
    const missing = run(['bin/run-branching', '--disposable', 'workflow file.cjs', 'cow storage']);
    assert.equal(missing.status, 1); assert.equal(missing.calls, ''); assert.match(missing.stderr, /requires --branching/);
    const help = run(['bin/run-coverage', '--branching', '--help']);
    assert.equal(help.status, 0); assert.equal(help.calls, ''); assert.match(help.stdout, /coverage collection is not supported yet/);
    const unsupported = run(['bin/run-coverage', '--branching', '--disposable', 'workflow file.cjs', 'cow storage'], {TEST_RUNNER: 'cypress'});
    assert.equal(unsupported.status, 1); assert.equal(unsupported.calls, ''); assert.match(unsupported.stderr, /not implemented yet/);
});
test('only AUTO reaches the worker, with default and legacy automatic spellings', t => {
    const {run}=launchFixture(t);
    for(const args of [[],['--auto']]) {
        const result=run(['bin/run-coverage','--branching','--disposable',...args,'manifest.json','workflow file.cjs','cow storage','AUTO']);
        assert.equal(result.status,37,result.stderr);assert.match(result.calls,/branching\/auto-cli.cjs/);
        assert.match(result.calls,/"magelens-plan","verify"/);
    }
    for(const mode of ['branching','L0','CALIBRATE','test-id']) {
        const result=run(['bin/run-coverage','--branching','--disposable','manifest.json','workflow file.cjs','cow storage',mode]);
        assert.equal(result.status,1);assert.equal(result.calls,'');assert.match(result.stderr,/AUTO is the only/);
    }
    const manual=run(['bin/run-coverage','--branching','--disposable','workflow file.cjs','cow storage']);
    assert.equal(manual.status,1);assert.equal(manual.calls,'');
});
test('stale automatic manifests stop before worker launch and remove the Rust controller', t => {
    const {run} = launchFixture(t);
    const result = run(['bin/run-coverage', '--branching', '--disposable', '--auto', 'manifest.json', 'workflow file.cjs', 'cow storage'], {TEST_VERIFY_FAIL: '1'});
    assert.equal(result.status, 23, result.stderr);
    assert.match(result.calls, /"magelens-plan","verify"/);
    assert.doesNotMatch(result.calls, /"--entrypoint","node"/);
    assert.match(result.calls, /\["rm","--force","a{64}"\]/);
});
test('adapter registry is lazy and leaves Cypress linear-only until implemented', () => {
    assert.equal(descriptor('playwright').image, 'branching-playwright');
    assert.equal(typeof loadRunner('playwright').open, 'function');
    assert.throws(() => loadRunner('cypress'), /normal linear run without --branching/);
    assert.throws(() => loadRunner('unknown'), /Unknown branching runner/);
});
test('planner requires a valid container and transports stdin and arguments without a shell', t => {
    assert.throws(() => planner(['cost-plan'], {}, {}), /Start the run with --branching/);
    assert.throws(() => planner([], {}, {MAGELENS_ORCHESTRATOR_CONTAINER: 'wrong;id'}), /Invalid orchestrator/);
    const directory = temporary(t);
    command(directory, 'docker', `#!${process.execPath}
const fs = require('node:fs');
console.log(JSON.stringify({args: process.argv.slice(2), input: fs.readFileSync(0, 'utf8')}));
`);
    const value = JSON.parse(planner(['cost-plan', 'literal;$(x)'], {input: '{"units":[]}', encoding: 'utf8', env: {...process.env, PATH: `${directory}:${process.env.PATH}`}}, {
        MAGELENS_ORCHESTRATOR_CONTAINER: 'b'.repeat(64), LLVM_PROFILE_FILE: '/shared/raw/%m-%p.profraw'
    }));
    assert.deepEqual(value, {args: ['exec', '-i', '--env', 'LLVM_PROFILE_FILE=/shared/raw/%m-%p.profraw', 'b'.repeat(64), 'magelens-plan', 'cost-plan', 'literal;$(x)'], input: '{"units":[]}'});
});
test('image inputs separate Rust from browser dependencies and track their own source', t => {
    const directory = temporary(t);
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
    for (const file of new Set(files)) {
        if (fs.existsSync(path.join(root, file)) && (file.startsWith('branching/') || file.startsWith('docker/runner/') || ['bin/image-inputs.cjs', 'dependencies.yaml', '.dockerignore', 'package.json'].includes(file))) copy(directory, file);
    }
    const before = {core: describe(directory, 'orchestrator').fingerprint, browser: describe(directory, 'playwright').fingerprint};
    fs.appendFileSync(path.join(directory, 'branching/runners/playwright/Dockerfile'), '\n');
    assert.equal(describe(directory, 'orchestrator').fingerprint, before.core);
    const changedBrowser = describe(directory, 'playwright').fingerprint;
    assert.notEqual(changedBrowser, before.browser);
    fs.appendFileSync(path.join(directory, 'branching/planner/src/lib.rs'), '\n');
    assert.notEqual(describe(directory, 'orchestrator').fingerprint, before.core);
    assert.equal(describe(directory, 'playwright').fingerprint, changedBrowser);
});
function imageFixture(t) {
    const directory = temporary(t);
    for (const file of ['bin/branching-image', 'bin/dependencies', 'dependencies.yaml']) copy(directory, file);
    fs.mkdirSync(path.join(directory, 'commands'));
    command(directory, 'commands/docker', `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2), fingerprint = 'c'.repeat(64);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'info') console.log('linux/x86_64');
if (args.includes('describe')) console.log(fingerprint + '\\torchestrator\\tbranching/planner');
if (args[0] === 'image' && args[1] === 'inspect') {
    if (!args.includes('--format')) process.exit(process.env.TEST_CACHE === '1' ? 0 : 1);
    console.log('linux/amd64 ' + (process.env.TEST_BAD_LABEL === '1' ? 'bad' : fingerprint));
}
if (args[0] === 'pull' && process.env.TEST_PULL_FAIL === '1') process.exit(1);
`);
    const log = path.join(directory, 'calls');
    return (args = [], extra = {}) => {
        fs.writeFileSync(log, '');
        const result = spawnSync('bash', ['bin/branching-image', 'orchestrator', ...args], {cwd: directory, encoding: 'utf8', env: {...process.env,
            MAGELENS_BRANCHING_BUILD_FROM_SOURCE: '0', PATH: `${directory}/commands:${process.env.PATH}`, MOCK_LOG: log, ...extra}});
        return {...result, calls: fs.readFileSync(log, 'utf8')};
    };
}
test('default images use cache or pull; missing images never silently build on the host', t => {
    const run = imageFixture(t);
    for (const extra of [{TEST_CACHE: '1'}, {}]) {
        const result = run([], extra); assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.calls, /"build"/);
        assert.match(result.stdout, /^magelens-orchestrator:inputs-c{64}-amd64\n$/);
    }
    const missing = run([], {TEST_PULL_FAIL: '1'});
    assert.equal(missing.status, 1); assert.match(missing.stderr, /No matching prebuilt/); assert.doesNotMatch(missing.calls, /"build"/);
    const stale = run([], {TEST_CACHE: '1', TEST_BAD_LABEL: '1'});
    assert.equal(stale.status, 1); assert.match(stale.stderr, /does not match/); assert.doesNotMatch(stale.calls, /"build"|"pull"/);
    const developer = run(['--build-from-source']);
    assert.equal(developer.status, 0, developer.stderr); assert.match(developer.calls, /"build"/); assert.doesNotMatch(developer.calls, /"pull"/);
});
