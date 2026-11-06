// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {inputs, kinds, select, validateManifest} = require('../bin/image-inputs.cjs');
const {synchronize} = require('../docker/runner/sync-node-modules.cjs');
const root = path.join(__dirname, '..');
function temporary(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-images-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    return directory;
}
function candidate() {
    return {schema: 1, version: require('../package.json').version, platform: 'linux/amd64', images: Object.fromEntries(kinds.map(kind =>
        [kind, {inputs: inputs(root, kind), digest: 'sha256:' + 'b'.repeat(64)}]))};
}
test('selects only immutable images with matching release, input hash and tested architecture', () => {
    for (const runner of ['cypress', 'playwright']) {
        const selected = select(root, candidate(), 'linux/amd64', runner);
        for (const entry of Object.values(selected)) assert.match(entry.image, /^ghcr\.io\/magelens\/[a-z-]+@sha256:[a-f0-9]{64}$/);
        assert.deepEqual(Object.values(select(root, candidate(), 'linux/arm64', runner)), [null, null]);
        const stale = candidate(); stale.version = '0.0.0';
        assert.deepEqual(Object.values(select(root, stale, 'linux/amd64', runner)), [null, null]);
        const mixed = candidate(); mixed.images.php.inputs = '0'.repeat(64);
        assert.equal(select(root, mixed, 'linux/amd64', runner).php, null);
        assert.ok(select(root, mixed, 'linux/amd64', runner)[`runner-${runner}`]);
    }
});
test('rejects tags, malformed manifests and untrusted registry strings', () => {
    for (const digest of ['latest', 'sha256:no', 'sha256:' + 'f'.repeat(63), 'x\nservices:']) {
        const value = candidate(); value.images.php.digest = digest;
        assert.throws(() => validateManifest(value), /provenance/);
    }
    for (const registry of ['evil.example/images', 'ghcr.io/magelens\nservices:', 'localhost:5000/x;id']) {
        assert.throws(() => select(root, candidate(), 'linux/amd64', 'cypress', registry), /registry/);
    }
});
test('patch and PHP source changes invalidate their images; custom package dependencies do not', t => {
    const directory = temporary(t);
    for (const file of ['dependencies.yaml', '.dockerignore', 'package.json', 'bin', 'docker']) fs.cpSync(path.join(root, file), path.join(directory, file), {recursive: true});
    const before = Object.fromEntries(kinds.map(kind => [kind, inputs(directory, kind)]));
    fs.appendFileSync(path.join(directory, 'package.json'), '\n');
    assert.equal(inputs(directory, 'runner-cypress'), before['runner-cypress']);
    fs.appendFileSync(path.join(directory, 'docker/runner/cypress-source/runner-fixes.patch'), '\n');
    assert.notEqual(inputs(directory, 'runner-cypress'), before['runner-cypress']);
    assert.equal(inputs(directory, 'php'), before.php);
    fs.appendFileSync(path.join(directory, 'docker/php/collect.php'), '\n');
    assert.notEqual(inputs(directory, 'php'), before.php);
});
function dependencyFixture(t) {
    const directory = temporary(t);
    for (const name of ['project', 'bundled']) {
        const target = path.join(directory, name);
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, 'package.json'), '{"name":"fixture"}');
        fs.writeFileSync(path.join(target, 'package-lock.json'), '{"lockfileVersion":3}');
        fs.mkdirSync(path.join(target, 'node_modules'));
        fs.writeFileSync(path.join(target, 'node_modules/module'), name);
    }
    const project = path.join(directory, 'project'), bundled = path.join(directory, 'bundled');
    fs.symlinkSync('module', path.join(bundled, 'node_modules/link'));
    execFileSync('tar', ['czf', path.join(bundled, 'node_modules.tar.gz'), '-C', bundled, 'node_modules']);
    return {project, bundled};
}
test('bundled dependencies replace stale volume entries and are reused on reinstall', t => {
    const {project, bundled} = dependencyFixture(t);
    const execute = (command, args, options) => {
        assert.equal(command, 'tar', 'Matching locks must not run npm ci');
        return execFileSync(command, args, options);
    };
    assert.equal(synchronize(project, bundled, execute), 'bundled');
    assert.equal(fs.readFileSync(path.join(project, 'node_modules/module'), 'utf8'), 'bundled');
    assert.equal(fs.readlinkSync(path.join(project, 'node_modules/link')), 'module');
    assert.equal(synchronize(project, bundled, () => assert.fail('No reinstall needed')), 'unchanged');
});
test('custom locks install once; failures never mark an incomplete dependency volume as current', t => {
    const {project, bundled} = dependencyFixture(t);
    fs.appendFileSync(path.join(project, 'package-lock.json'), '\n');
    let calls = 0;
    const execute = (command, args, options) => {
        assert.equal(command, 'npm'); assert.equal(args[0], 'ci'); assert.ok(args.includes('--ignore-scripts'));
        assert.equal(options.cwd, project); calls++;
        if (calls === 1) throw new Error('Registry unavailable');
        fs.writeFileSync(path.join(project, 'node_modules/custom'), 'installed');
    };
    assert.throws(() => synchronize(project, bundled, execute), /Registry unavailable/);
    assert.equal(fs.existsSync(path.join(project, 'node_modules/.magelens-dependencies')), false);
    assert.equal(synchronize(project, bundled, execute), 'installed');
    assert.equal(synchronize(project, bundled, execute), 'unchanged');
    assert.equal(calls, 2);
});
test('both installer entry points advertise the explicit source mode', () => {
    for (const entry of ['install.sh', 'bin/install']) {
        const result = spawnSync('bash', [entry, '--help'], {cwd: root, encoding: 'utf8'});
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /--build-from-source/);
    }
});

function prepareFixture(t) {
    const directory = temporary(t);
    for (const file of ['dependencies.yaml', 'bin/common', 'bin/dependencies', 'bin/compose-project', 'bin/prepare-images']) {
        fs.mkdirSync(path.dirname(path.join(directory, file)), {recursive: true});
        fs.copyFileSync(path.join(root, file), path.join(directory, file));
    }
    fs.mkdirSync(path.join(directory, '.runtime'));
    fs.writeFileSync(path.join(directory, '.runtime/install-profile'), 'luma cypress mageos\n');
    fs.writeFileSync(path.join(directory, '.runtime/compose-project-name'), 'image-test\n');
    fs.writeFileSync(path.join(directory, '.env'), 'COMPOSE_PROJECT_NAME=image-test\n');
    fs.writeFileSync(path.join(directory, 'bin/build-php-image'), '#!/bin/sh\necho source-php >> "$MOCK_LOG"\n', {mode: 0o755});
    fs.mkdirSync(path.join(directory, 'commands'));
    fs.writeFileSync(path.join(directory, 'commands/docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
const selected = JSON.parse(process.env.MOCK_SELECTION);
if (args[0] === 'info') console.log('linux/x86_64');
if (args.includes('resolve')) fs.writeFileSync('.runtime/prebuilt-images.json', JSON.stringify(selected));
if (args.includes('/images.json') || args.some(arg => arg.includes('require("/images.json")'))) {
    const data = JSON.parse(fs.readFileSync('.runtime/prebuilt-images.json'));
    console.log(data[args.at(-2)]?.[args.at(-1)] || '');
}
if (args[0] === 'image' && args[1] === 'inspect') {
    const entry = Object.values(selected).find(entry => entry?.image === args.at(-1));
    console.log(process.env.MOCK_BAD_LABEL === '1' ? 'stale' : entry.inputs);
}
if (args.some(arg => arg.includes('verifyInstalled')) && process.env.MOCK_BAD_CYPRESS === '1') process.exit(3);
`, {mode: 0o755});
    const log = path.join(directory, 'calls');
    return {directory, run: (mode = '0', extra = {}, selected = select(root, candidate(), 'linux/amd64', 'cypress')) => {
        fs.writeFileSync(log, '');
        const result = spawnSync('bash', ['bin/prepare-images', 'fixture:node', mode], {cwd: directory, encoding: 'utf8', env: {
            ...process.env, MAGELENS_REQUIRE_PREBUILT: '', MAGELENS_IMAGE_MANIFEST: '', COMPOSE_PROJECT_NAME: 'image-test',
            PATH: `${directory}/commands:${process.env.PATH}`, MOCK_LOG: log, MOCK_SELECTION: JSON.stringify(selected), ...extra
        }});
        return {...result, calls: fs.readFileSync(log, 'utf8')};
    }};
}
test('prebuilt installation pulls digests, checks Cypress and builds only the local PHP account layer', t => {
    const {directory, run} = prepareFixture(t);
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.calls, /source-php|"build","--pull","runner"/);
    assert.match(result.calls, /verifyInstalled/);
    assert.match(result.calls, /"build","phpfpm"/);
    const overlay = fs.readFileSync(path.join(directory, '.runtime/compose.images.yaml'), 'utf8');
    assert.match(overlay, /docker\/php\/uid.Dockerfile/);
    assert.match(overlay, /build: !reset null/);
    assert.match(overlay, /runner-cypress@sha256:/);
});
test('explicit source build ignores release manifests and removes an earlier prebuilt override', t => {
    const {directory, run} = prepareFixture(t);
    fs.writeFileSync(path.join(directory, '.runtime/compose.images.yaml'), 'stale');
    const result = run('1');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, /source-php/);
    assert.match(result.calls, /"build","--pull","runner"/);
    assert.doesNotMatch(result.calls, /"resolve"|"pull"|verifyInstalled/);
    assert.equal(fs.existsSync(path.join(directory, '.runtime/compose.images.yaml')), false);
});
test('stale labels and Cypress provenance stop installation before any build', t => {
    for (const setting of ['MOCK_BAD_LABEL', 'MOCK_BAD_CYPRESS']) {
        const {run} = prepareFixture(t);
        const result = run('0', {[setting]: '1'});
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.calls, /source-php|"build"/);
    }
});
test('missing compatible images build locally, but cannot silently satisfy CI', t => {
    const {run} = prepareFixture(t);
    const result = run('0', {}, {});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, /source-php/);
    assert.match(result.calls, /"build","--pull","runner"/);
    const required = run('0', {MAGELENS_REQUIRE_PREBUILT: '1'}, {});
    assert.notEqual(required.status, 0);
    assert.match(required.stderr, /requires compatible prebuilt/);
    assert.doesNotMatch(required.calls, /source-php|"build"/);
});
