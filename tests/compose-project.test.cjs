// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function workspace(t, content = '') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-project-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    for (const file of ['install.sh', 'dependencies.yaml', 'bin/install', 'bin/common', 'bin/dependencies',
        'bin/compose-project', 'bin/application-domain', 'bin/application-compose', 'bin/expose-tools', 'bin/runner', 'bin/run-coverage']) {
        fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
        fs.copyFileSync(path.resolve(__dirname, '..', file), path.join(root, file));
    }
    fs.mkdirSync(path.join(root, '.runtime'));
    fs.mkdirSync(path.join(root, 'commands'));
    if (content) fs.writeFileSync(path.join(root, '.env'), content, {mode: 0o600});
    fs.writeFileSync(path.join(root, 'commands/git'), '#!/bin/sh\nexit 29\n', {mode: 0o755});
    fs.writeFileSync(path.join(root, 'commands/docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'info') process.exit(0);
if (args.includes('version')) {console.log('2.24.4'); process.exit(0);}
fs.appendFileSync('calls.jsonl', JSON.stringify({args, project: process.env.COMPOSE_PROJECT_NAME}) + '\\n');
process.exit(Number(process.env.TEST_DOCKER_EXIT || 0));
`, {mode: 0o755});
    const run = (script, args = [], env = {}) => spawnSync('bash', [script, ...args], {
        cwd: root, encoding: 'utf8', env: {...process.env, COMPOSE_PROJECT_NAME: '', APPLICATION_DOMAIN: '',
            PATH: `${root}/commands:${process.env.PATH}`, ...env}
    });
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');
    const write = (file, value) => fs.writeFileSync(path.join(root, file), value);
    const resolve = (requested = '', env = {}) => run('-c', [
        'ROOT=$PWD; source bin/compose-project; resolve_compose_project "$1" && printf "%s" "$COMPOSE_PROJECT_NAME"', 'test', requested
    ], env);
    // Stop at the network boundary, after configuration but before installing services.
    const install = (args = [], env = {}) => run('install.sh', ['--container-only', ...args], env);
    return {root, run, read, write, resolve, install};
}

test('new projects follow argument, environment, saved name, default precedence without changing domain or ports', t => {
    for (const [content, argument, env, expected] of [
        ['', [], {}, 'magelens'],
        ['COMPOSE_PROJECT_NAME=saved-shop\n', [], {}, 'saved-shop'],
        ['COMPOSE_PROJECT_NAME=saved-shop\n', [], {COMPOSE_PROJECT_NAME: 'env-shop'}, 'env-shop'],
        ['COMPOSE_PROJECT_NAME=saved-shop\n', ['--project-name', 'client-shop'], {COMPOSE_PROJECT_NAME: 'env-shop'}, 'client-shop'],
        ['', ['--project-name=9_client-shop'], {}, '9_client-shop']
    ]) {
        const f = workspace(t, content + 'APPLICATION_DOMAIN=independent.test\nAPPLICATION_PORT=18080\nAPPLICATION_HTTPS_PORT=18443\nRUNNER_VIEW_PORT=16080\n');
        const result = f.install(argument, env);
        assert.equal(result.status, 29, result.stderr);
        assert.equal(f.read('.runtime/compose-project-name'), expected + '\n');
        assert.match(f.read('.env'), new RegExp(`^COMPOSE_PROJECT_NAME=${expected}$`, 'm'));
        assert.match(f.read('.env'), /^APPLICATION_DOMAIN=independent.test$/m);
        assert.match(f.read('.env'), /^APPLICATION_PORT=18080\nAPPLICATION_HTTPS_PORT=18443\nRUNNER_VIEW_PORT=16080$/m);
        assert.equal(fs.statSync(path.join(f.root, '.env')).mode & 0o777, 0o600);
        const saved = f.read('.env');
        assert.equal(f.install().status, 29);
        assert.equal(f.read('.env'), saved, 'Interrupted installation reuses its saved name');
        assert.equal(f.resolve().stdout, expected);
        assert.equal(fs.existsSync(path.join(f.root, '.runtime/workflow.lock')), false);
    }
});

test('fresh installation without .env retains default ports and project name', t => {
    const f = workspace(t);
    assert.equal(f.install().status, 29);
    assert.match(f.read('.env'), /^COMPOSE_PROJECT_NAME=magelens$/m);
    assert.match(f.read('.env'), /^APPLICATION_PORT=80\nAPPLICATION_HTTPS_PORT=443\nRUNNER_VIEW_PORT=6080$/m);
});

test('legacy installations with an unnamed .env retain their Compose directory name', t => {
    const f = workspace(t, 'APPLICATION_PORT=18080\n');
    f.write('.runtime/installed', '3\n');
    f.write('.runtime/install-profile', 'luma cypress magento\n');
    const expected = path.basename(f.root).toLowerCase();
    assert.equal(f.resolve().stdout, expected);
    assert.equal(f.install().status, 29);
    assert.equal(f.read('.runtime/compose-project-name'), expected + '\n');
    assert.match(f.read('.env'), new RegExp(`^COMPOSE_PROJECT_NAME=${expected}$`, 'm'));
});

test('literal quoted dotenv names, comments, CRLF and duplicate keys are normalized without executing code', t => {
    const f = workspace(t, 'COMPOSE_PROJECT_NAME=old\r\n COMPOSE_PROJECT_NAME = "client_shop-2"\t# comment\r\nUNRELATED=$(touch should-not-exist)\n');
    assert.equal(f.resolve().stdout, 'client_shop-2');
    assert.equal(f.install().status, 29);
    assert.equal(f.read('.env').match(/^COMPOSE_PROJECT_NAME=/gm).length, 1);
    assert.match(f.read('.env'), /^UNRELATED=\$\(touch should-not-exist\)$/m);
    assert.equal(fs.existsSync(path.join(f.root, 'should-not-exist')), false);
});

test('invalid and missing project names fail before mutating configuration or installation state', t => {
    const f = workspace(t, 'COMPOSE_PROJECT_NAME=client-shop\n');
    f.write('.runtime/installed', '3\n');
    f.write('.runtime/install-profile', 'luma cypress magento\n');
    const original = f.read('.env');
    for (const args of [['--project-name'], ['--project-name', ''], ['--project-name='], ['--project-name', '--mageos'],
        ...['Uppercase', '-shop', '_shop', 'shop.test', 'two shops', '../shop', '$(touch should-not-exist)', 'éshop', 'shop\nnext'].map(name => ['--project-name', name])]) {
        const result = f.install(args);
        assert.notEqual(result.status, 0, JSON.stringify(args));
        assert.match(result.stderr, /project name|--project-name requires/);
        assert.equal(f.read('.env'), original);
        assert.equal(f.read('.runtime/installed'), '3\n');
        assert.equal(f.read('.runtime/install-profile'), 'luma cypress magento\n');
        assert.equal(fs.existsSync(path.join(f.root, '.runtime/workflow.lock')), false);
    }
    assert.notEqual(f.resolve('', {COMPOSE_PROJECT_NAME: 'INVALID'}).status, 0);
    f.write('.env', 'COMPOSE_PROJECT_NAME=$(touch should-not-exist)\n');
    assert.notEqual(f.resolve().status, 0);
    assert.equal(fs.existsSync(path.join(f.root, 'should-not-exist')), false);
});

test('installed and legacy projects reject renames and preserve state; matching explicit names override a conflicting shell', t => {
    for (const tracked of [false, true]) {
        const f = workspace(t, 'COMPOSE_PROJECT_NAME=client-shop\n');
        f.write('.runtime/installed', '3\n');
        f.write('.runtime/install-profile', 'luma cypress magento\n');
        if (tracked) f.write('.runtime/compose-project-name', 'client-shop\n');
        for (const [args, env] of [[['--project-name', 'other-shop'], {}], [[], {COMPOSE_PROJECT_NAME: 'other-shop'}]]) {
            const result = f.install(args, env);
            assert.equal(result.status, 1);
            assert.match(result.stderr, /different database volumes/);
            assert.match(result.stderr, /separate directory/);
            assert.equal(f.read('.env'), 'COMPOSE_PROJECT_NAME=client-shop\n');
            assert.equal(f.read('.runtime/installed'), '3\n');
            assert.equal(f.read('.runtime/install-profile'), 'luma cypress magento\n');
        }
        assert.equal(f.install(['--project-name', 'client-shop'], {COMPOSE_PROJECT_NAME: 'other-shop'}).status, 29);
        assert.equal(f.read('.runtime/compose-project-name'), 'client-shop\n');
        f.write('.env', 'COMPOSE_PROJECT_NAME=edited-shop\n');
        assert.equal(f.resolve().status, 1, 'A manual .env edit cannot silently change the recorded project');
    }
});

test('service, runner and coverage entry points reuse the saved project and reject conflicting overrides', t => {
    const f = workspace(t, 'COMPOSE_PROJECT_NAME=client-shop\n');
    for (const child of ['bin', 'lib', 'env']) fs.mkdirSync(path.join(f.root, '.runtime/docker-magento/compose', child), {recursive: true});
    f.write('.runtime/docker-magento/compose/bin/stop', '#!/bin/sh\nexec bin/docker-compose stop "$@"\n');
    f.write('.runtime/docker-magento/compose/env/local.env', 'TEST=1\n');
    assert.equal(f.run('bin/expose-tools').status, 0);
    f.write('.runtime/installed', '3\n');
    f.write('.runtime/install-profile', 'luma cypress magento\n');
    f.write('.runtime/compose-project-name', 'client-shop\n');
    for (const [script, args] of [['bin/application-compose', ['stop']], ['bin/start', []], ['bin/stop', []],
        ['bin/runner', ['node', '-p', '1 + 1']], ['bin/run-coverage', []]]) {
        f.write('calls.jsonl', '');
        const result = f.run(script, args, {TEST_DOCKER_EXIT: '23'});
        assert.notEqual(result.status, 0, 'Return the container failure');
        const calls = f.read('calls.jsonl').trim().split('\n').map(JSON.parse);
        assert.ok(calls.length > 0);
        assert.ok(calls.every(call => call.project === 'client-shop'), script);
        f.write('calls.jsonl', '');
        const rejected = f.run(script, args, {COMPOSE_PROJECT_NAME: 'other-shop'});
        assert.notEqual(rejected.status, 0);
        assert.match(rejected.stderr, /different database volumes/);
        assert.equal(f.read('calls.jsonl'), '', 'No Compose command may target the other project');
    }
    for (const args of [['-p', 'other-shop', 'down'], ['--profile', '*', '--project-name=other-shop', 'down'], ['-pother-shop', 'stop']]) {
        assert.match(f.run('bin/application-compose', args).stderr, /different database volumes/);
    }
    assert.equal(f.run('bin/application-compose', ['--project-name', 'client-shop', 'ps'], {COMPOSE_PROJECT_NAME: 'other-shop'}).status, 0);
});

test('installer help documents project-name input and precedence without Docker', t => {
    const f = workspace(t);
    fs.writeFileSync(path.join(f.root, 'commands/docker'), '#!/bin/sh\nexit 98\n');
    const result = f.run('install.sh', ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--project-name NAME/);
    assert.match(result.stdout, /environment > saved .env > magelens/);
    assert.equal(fs.existsSync(path.join(f.root, '.env')), false);
});
