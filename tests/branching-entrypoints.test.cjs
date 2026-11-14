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
    for (const file of ['bin/run-coverage', 'bin/run-branching', 'bin/plan-branching', 'branching/configs/entrypoints.conf']) copy(directory, file);
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
            PATH: `${directory}/commands:${process.env.PATH}`, MOCK_LOG: log,
            MAGELENS_BRANCHING_MANIFEST: '', MAGELENS_BRANCHING_CONFIG: '', MAGELENS_BRANCHING_STORAGE: '', ...env}});
        return {...result, calls: fs.readFileSync(log, 'utf8')};
    }};
}
function defaultProject(directory) {
    fs.copyFileSync(path.join(directory, 'manifest.json'), path.join(directory, '.runtime/branching-plan.json'));
    fs.copyFileSync(path.join(directory, 'workflow file.cjs'), path.join(directory, 'branching.config.cjs'));
}
test('branching and calibration use saved project paths and create default storage', t => {
    const {directory, run} = launchFixture(t);
    defaultProject(directory);
    for (const options of [[], ['--calibrate']]) {
        const result = run(['bin/run-coverage', '--branching', ...options]);
        assert.equal(result.status, 37, result.stderr);
        const worker = result.calls.split('\n').filter(line => line.startsWith('[')).map(JSON.parse)
            .find(args => args.includes('node'));
        assert.deepEqual(worker.slice(-4), [options.length ? 'branching/calibration-cli.cjs' : 'branching/auto-cli.cjs',
            path.join(directory, '.runtime/branching-plan.json'), path.join(directory, 'branching.config.cjs'),
            path.join(directory, '.runtime/branching-storage')]);
        assert.ok(fs.statSync(path.join(directory, '.runtime/branching-storage')).isDirectory());
    }
});
test('branching supports partial paths, saved environment overrides and explicit path precedence', t => {
    const {directory, run} = launchFixture(t);
    defaultProject(directory);
    const env = {MAGELENS_BRANCHING_MANIFEST: 'manifest.json', MAGELENS_BRANCHING_CONFIG: 'workflow file.cjs', MAGELENS_BRANCHING_STORAGE: 'cow storage'};
    for (const options of [[], ['--calibrate']]) {
        const result = run(['bin/run-coverage', '--branching', ...options], env);
        assert.equal(result.status, 37, result.stderr);
        assert.ok(result.calls.includes(JSON.stringify(path.join(directory, 'cow storage'))));
    }
    for (const paths of [['manifest.json'], ['manifest.json', 'workflow file.cjs']]) {
        const result = run(['bin/run-coverage', '--branching', ...paths]);
        assert.equal(result.status, 37, result.stderr);
        assert.ok(result.calls.includes(JSON.stringify(path.join(directory, '.runtime/branching-storage'))));
    }
    const explicit = run(['bin/run-coverage', '--branching', 'manifest.json', 'workflow file.cjs', 'cow storage'],
        Object.fromEntries(Object.keys(env).map(key => [key, 'missing'])));
    assert.equal(explicit.status, 37, explicit.stderr);
});
test('missing default setup and active recovery fail before creating storage or starting containers', t => {
    const {directory, run} = launchFixture(t);
    let result = run(['bin/run-coverage', '--branching', '--calibrate']);
    assert.equal(result.status, 1); assert.equal(result.calls, '');
    assert.match(result.stderr, /plan-branching SOURCE_ROOT/);
    fs.copyFileSync(path.join(directory, 'manifest.json'), path.join(directory, '.runtime/branching-plan.json'));
    result = run(['bin/run-coverage', '--branching']);
    assert.equal(result.status, 1); assert.equal(result.calls, '');
    assert.match(result.stderr, /Branching configuration not found: branching.config.cjs/);
    defaultProject(directory);
    for (const marker of ['workflow.lock', 'branching-recovery.json']) {
        const file = path.join(directory, '.runtime', marker);
        fs.writeFileSync(file, '');
        result = run(['bin/run-coverage', '--branching', '--calibrate']);
        assert.equal(result.status, 1); assert.equal(result.calls, ''); assert.match(result.stderr, /recovery first/);
        fs.rmSync(file);
    }
    assert.ok(!fs.existsSync(path.join(directory, '.runtime/branching-storage')));
});
test('default storage rejects symlinks and custom storage must already exist', t => {
    const {directory, run} = launchFixture(t);
    defaultProject(directory);
    const storage = path.join(directory, '.runtime/branching-storage');
    fs.symlinkSync(path.join(directory, 'cow storage'), storage);
    let result = run(['bin/run-coverage', '--branching']);
    assert.equal(result.status, 1); assert.match(result.stderr, /without symlinks/);
    assert.doesNotMatch(result.calls, /--detach/);
    fs.unlinkSync(storage);
    result = run(['bin/run-coverage', '--branching'], {MAGELENS_BRANCHING_STORAGE: 'missing storage'});
    assert.equal(result.status, 1); assert.match(result.stderr, /Checkpoint storage not found/);
    assert.ok(!fs.existsSync(path.join(directory, 'missing storage')));
});
test('planner shares the default manifest and honors environment and positional overrides', t => {
    const {directory, run} = launchFixture(t);
    for (const [args, env, output] of [
        [[], {}, '.runtime/branching-plan.json'],
        [[], {MAGELENS_BRANCHING_MANIFEST: '.runtime/custom.json'}, '.runtime/custom.json'],
        [['.runtime/explicit.json'], {MAGELENS_BRANCHING_MANIFEST: '.runtime/custom.json'}, '.runtime/explicit.json']
    ]) {
        const result = run(['bin/plan-branching', 'branching', ...args], env);
        assert.equal(result.status, 0, result.stderr);
        const call = result.calls.split('\n').filter(line => line.startsWith('[')).map(JSON.parse).at(-1);
        assert.deepEqual(call.slice(-3), ['plan', path.join(directory, 'branching'), path.join(directory, output)]);
    }
});
test('explicit calibration uses the same isolated launcher without executing tests', t => {
    const {directory,run}=launchFixture(t);
    const result=run(['bin/run-coverage','--branching','--calibrate','manifest.json','workflow file.cjs','cow storage']);
    assert.equal(result.status,37,result.stderr);
    const calls=result.calls.split('\n').filter(line=>line.startsWith('[')).map(JSON.parse);
    const worker=calls.find(args=>args.includes('node'));
    assert.equal(worker[worker.indexOf('--cpus')+1], '2');
    assert.ok(worker.includes('org.magelens.role=branching-driver'));
    assert.deepEqual(worker.slice(-4),['branching/calibration-cli.cjs',path.join(directory,'manifest.json'),path.join(directory,'workflow file.cjs'),path.join(directory,'cow storage')]);
    assert.ok(calls.some(args=>args[0]==='rm'&&args[1]==='--force'));
});
test('branching opt-in preserves literal arguments, worker status and controller cleanup', t => {
    const {directory, run} = launchFixture(t);
    const result = run(['bin/run-coverage', 'manifest.json', 'workflow file.cjs', 'cow storage', '--branching']);
    assert.equal(result.status, 37, result.stderr);
    const calls = result.calls.split('\n').filter(line => line.startsWith('[')).map(JSON.parse);
    const worker = calls.find(args => args.includes('node'));
    assert.equal(worker[worker.indexOf('--cpus')+1], '2');
    assert.ok(worker.includes('org.magelens.workspace=' + directory));
    assert.deepEqual(worker.slice(-4), ['branching/auto-cli.cjs', path.join(directory, 'manifest.json'), path.join(directory, 'workflow file.cjs'), path.join(directory, 'cow storage')]);
    assert.ok(worker.includes('MAGELENS_ORCHESTRATOR_CONTAINER=' + 'a'.repeat(64)));
    assert.ok(worker.includes('type=volume,source=modules,target=/workspace/node_modules,readonly'));
    assert.deepEqual(calls.at(-1), ['rm', '--force', 'a'.repeat(64)]);
});
test('direct entry requires opt-in; help and unsupported adapter do not start containers', t => {
    const {run} = launchFixture(t);
    const missing = run(['bin/run-branching', '--disposable', 'workflow file.cjs', 'cow storage']);
    assert.equal(missing.status, 1); assert.equal(missing.calls, ''); assert.match(missing.stderr, /requires --branching/);
    const unacknowledged = run(['bin/run-branching', '--branching', 'manifest.json', 'workflow file.cjs', 'cow storage']);
    assert.equal(unacknowledged.status, 1); assert.equal(unacknowledged.calls, '');
    assert.match(unacknowledged.stderr, /Use .*run-coverage --branching/);
    const help = run(['bin/run-coverage', '--branching', '--help']);
    assert.equal(help.status, 0); assert.equal(help.calls, ''); assert.match(help.stdout, /coverage collection is not supported yet/);
    assert.doesNotMatch(help.stdout, /--disposable/);
    const unsupported = run(['bin/run-coverage', '--branching', 'workflow file.cjs', 'cow storage'], {TEST_RUNNER: 'unknown'});
    assert.equal(unsupported.status, 1); assert.equal(unsupported.calls, ''); assert.match(unsupported.stderr, /Unknown branching runner/);
});
test('legacy explicit acknowledgment still reaches both branching workers', t => {
    const {run} = launchFixture(t);
    for (const options of [[], ['--calibrate']]) {
        const result = run(['bin/run-coverage', '--branching', '--disposable', ...options,
            'manifest.json', 'workflow file.cjs', 'cow storage']);
        assert.equal(result.status, 37, result.stderr);
        assert.match(result.calls, options.length ? /branching\/calibration-cli.cjs/ : /branching\/auto-cli.cjs/);
    }
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
    const {run, directory} = launchFixture(t);
    const result = run(['bin/run-coverage', '--branching', '--disposable', '--auto', 'manifest.json', 'workflow file.cjs', 'cow storage'], {TEST_VERIFY_FAIL: '1'});
    const failure = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json.error.json')));
    assert.equal(failure.statusCode, 500); assert.equal(failure.code, 'ESTIMATION_FAILED');
    assert.equal(fs.readdirSync(directory).some(name => name.includes('.verify-')), false);
    assert.equal(result.status, 23, result.stderr);
    assert.match(result.calls, /"magelens-plan","verify"/);
    assert.doesNotMatch(result.calls, /"--entrypoint","node"/);
    assert.match(result.calls, /\["rm","--force","a{64}"\]/);
});
test('adapter registry loads either runner without requiring the other browser package', () => {
    assert.equal(descriptor('playwright').image, 'branching-playwright');
    assert.equal(typeof loadRunner('playwright').open, 'function');
    assert.equal(descriptor('cypress').image, 'branching-cypress');
    assert.equal(typeof loadRunner('cypress').open, 'function');
    assert.equal(typeof loadRunner('cypress').native.collect, 'function');
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
        if (fs.existsSync(path.join(root, file)) && (file.startsWith('branching/') || file.startsWith('docker/runner/') || ['bin/image-inputs.cjs', 'bin/sync-dependencies.cjs', 'bin/sync-runner-dependencies', 'dependencies.yaml', '.dockerignore', 'package.json', 'package-lock.json', 'branching-baseline.json'].includes(file))) copy(directory, file);
    }
    const before = {core: describe(directory, 'orchestrator').fingerprint, browser: describe(directory, 'playwright').fingerprint, cypress: describe(directory, 'cypress').fingerprint};
    fs.appendFileSync(path.join(directory, 'branching/runners/cypress/Dockerfile'), '\n');
    assert.notEqual(describe(directory, 'cypress').fingerprint, before.cypress);
    assert.equal(describe(directory, 'playwright').fingerprint, before.browser);
    assert.equal(describe(directory, 'orchestrator').fingerprint, before.core);
    fs.appendFileSync(path.join(directory, 'branching/runners/playwright/Dockerfile'), '\n');
    assert.equal(describe(directory, 'orchestrator').fingerprint, before.core);
    const changedBrowser = describe(directory, 'playwright').fingerprint;
    assert.notEqual(changedBrowser, before.browser);
    fs.appendFileSync(path.join(directory, 'branching/planner/src/lib.rs'), '\n');
    assert.notEqual(describe(directory, 'orchestrator').fingerprint, before.core);
    assert.equal(describe(directory, 'playwright').fingerprint, changedBrowser);
    const changedCore = describe(directory, 'orchestrator').fingerprint;
    fs.appendFileSync(path.join(directory, 'branching/build-runner.sh'), '\n');
    assert.notEqual(describe(directory, 'playwright').fingerprint, changedBrowser);
    assert.equal(describe(directory, 'orchestrator').fingerprint, changedCore);
});
function imageFixture(t, kind = 'orchestrator') {
    const directory = temporary(t);
    for (const file of ['bin/branching-image', 'bin/common', 'bin/dependencies', 'bin/sync-dependencies.cjs',
        'bin/sync-runner-dependencies', 'branching/build-runner.sh', 'docker/runner/Dockerfile',
        'dependencies.yaml', 'package.json', 'package-lock.json', '.dockerignore']) copy(directory, file);
    if(kind === 'orchestrator') {
        for(const file of ['branching/build-orchestrator.sh','branching-baseline.json','branching/estimation.cjs',
            'branching/identity.cjs','branching/configs/messages.cjs',
            'branching/planner/Dockerfile','branching/planner/Cargo.toml','branching/planner/Cargo.lock']) copy(directory,file);
        for(const folder of ['branching/planner/src','branching/planner/tests','branching/predictor'])
            fs.cpSync(path.join(root,folder),path.join(directory,folder),{recursive:true});
    }
    fs.mkdirSync(path.join(directory, 'commands'));
    command(directory, 'commands/docker', `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2), fingerprint = 'c'.repeat(64);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'info') console.log('linux/x86_64');
if (args.includes('describe')) console.log(fingerprint + (['playwright', 'cypress'].includes(args.at(-1))
    ? '\\tbranching-' + args.at(-1) + '\\tbranching/runners/' + args.at(-1) : '\\torchestrator\\tbranching/planner'));
if (args.includes('base')) process.exit(99);
if (args[0] === 'image' && args[1] === 'inspect') {
    if (!args.includes('--format')) process.exit(process.env.TEST_CACHE === '1' ? 0 : 1);
    console.log('linux/amd64 ' + (process.env.TEST_BAD_LABEL === '1' ? 'bad' : fingerprint));
}
if (args[0] === 'pull' && process.env.TEST_PULL_FAIL === '1') process.exit(1);
if (args[0] === 'build' && args.at(-1) === '-') fs.readFileSync(0);
if (args[0] === 'build' && args.includes('--target') && process.env.TEST_BASE_BUILD_FAIL === '1') process.exit(29);
`);
    const log = path.join(directory, 'calls');
    return (args = [], extra = {}) => {
        fs.writeFileSync(log, '');
        const original = ['package.json', 'package-lock.json'].map(file => fs.readFileSync(path.join(directory, file), 'utf8'));
        const result = spawnSync('bash', ['bin/branching-image', kind, ...args], {cwd: directory, encoding: 'utf8', env: {...process.env,
            MAGELENS_BRANCHING_BUILD_FROM_SOURCE: '0', PATH: `${directory}/commands:${process.env.PATH}`, MOCK_LOG: log, ...extra}});
        assert.deepEqual(['package.json', 'package-lock.json'].map(file => fs.readFileSync(path.join(directory, file), 'utf8')), original);
        assert.deepEqual(fs.existsSync(path.join(directory, '.runtime')) ? fs.readdirSync(path.join(directory, '.runtime')) : [], []);
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
test('explicit browser builds compile the product runner without release lookup and clean their context', t => {
    for (const runner of ['playwright', 'cypress']) {
    const run = imageFixture(t, runner);
    const result = run(['--build-from-source']);
    assert.equal(result.status, 0, result.stderr);
    const calls = result.calls.trim().split('\n').map(JSON.parse);
    const builds = calls.filter(args => args[0] === 'build');
    assert.equal(builds.length, 2);
    assert.ok(builds[0].includes(runner));
    assert.ok(builds[0].some(arg => arg.endsWith('/docker/runner/Dockerfile')));
    assert.ok(calls.some(args => args.includes('bin/sync-dependencies.cjs') && args.includes('MAGELENS_RUNNER')));
    assert.ok(builds[1].includes('RUNNER_IMAGE=magelens-branching-' + runner + '-base:inputs-' + 'c'.repeat(64) + '-amd64'));
    assert.equal(result.stdout, 'magelens-branching-' + runner + ':inputs-' + 'c'.repeat(64) + '-amd64\n');
    assert.ok(!calls.some(args => args.includes('base')));
    const failed = run(['--build-from-source'], {TEST_BASE_BUILD_FAIL: '1'});
    assert.equal(failed.status, 29, failed.stderr);
    assert.equal(failed.calls.trim().split('\n').map(JSON.parse).filter(args => args[0] === 'build').length, 1);
    }
});

test('checkpoint coverage uses only the matching active Playwright run', t => {
    const {activeCoverage} = require('../branching/cli.cjs');
    const workspace = temporary(t);
    const directory = path.join(workspace, 'coverage');
    fs.mkdirSync(directory);
    const id = 'a'.repeat(32);
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({id}));
    assert.deepEqual(activeCoverage(workspace), {});
    const marker = path.join(directory, '.active-run');
    fs.writeFileSync(marker, 'b'.repeat(32));
    assert.throws(() => activeCoverage(workspace), /does not match/);
    fs.writeFileSync(marker, id);
    assert.deepEqual(activeCoverage(workspace), {
        coverageRunId:id,
        javascriptCoverageDirectory:path.join(workspace, '.nyc_output'),
        templateCoverageDirectory:path.join(directory, 'raw', 'templates')
    });
});
