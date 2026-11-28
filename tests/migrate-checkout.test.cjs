// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {repository, projectFile} = require('./project-path.cjs');

function checkout(t) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-migrate-'));
    t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
    const root = path.join(temp, 'Client Shop');
    fs.mkdirSync(root);
    function write(file, content, mode = 0o600) {
        const dest = path.join(root, file);
        fs.mkdirSync(path.dirname(dest), {recursive: true});
        fs.writeFileSync(dest, content, {mode});
    }
    const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=test@example.org',
        '-c', 'commit.gpgsign=false', ...args], {cwd: root});
    git('init', '--quiet');
    write('.gitignore', fs.readFileSync(projectFile('.gitignore')));
    write('bin/compose-project', fs.readFileSync(projectFile('bin/compose-project')));
    write('src/app/code/Client/Module.php', 'updated tracked module');
    git('add', '.');
    git('commit', '-qm', 'original layout');
    fs.mkdirSync(path.join(root, 'compose'));
    for (const file of ['src', 'bin', '.gitignore']) git('mv', file, 'compose/');
    write('.gitignore', fs.readFileSync(path.join(repository, '.gitignore')));
    write('migrate-checkout.sh', fs.readFileSync(path.join(repository, 'migrate-checkout.sh')), 0o755);
    git('add', '.');
    git('commit', '-qm', 'compose layout');
    git('checkout', '--quiet', 'HEAD^');

    write('.runtime/install-profile', 'hyva playwright mageos\n');
    write('.runtime/installed', '6\n');
    write('.env', 'APPLICATION_DOMAIN=client.test\nAPPLICATION_HTTPS_PORT=8443\n');
    write('env/composer.env', 'private fixture');
    for (const file of ['lib/docker.sh', 'compose.versions.yaml', 'rootCA.pem', 'policies.json', 'node_modules/module/index.js']) write(file, file);
    write('bin/start', '#!/bin/sh\n', 0o700);
    write('src/vendor/autoload.php', 'installed dependency');
    write('src/app/etc/env.php', 'database configuration');
    write('src/app/code/Client/Extra.php', 'local module');
    write('src/pub/media/fixture', 'media');
    fs.symlinkSync('fixture', path.join(root, 'src/pub/media/link'));
    write('coverage/index.html', 'previous report');
    write('cypress/e2e/local.cy.js', 'custom test');
    git('checkout', '--quiet', '-');

    write('commands/docker', '#!/bin/sh\n[ "$1" = ps ] || exit 91\nprintf "%s" "$TEST_CONTAINERS"\n', 0o755);
    const run = (env = {}) => spawnSync('./migrate-checkout.sh', {cwd: root, encoding: 'utf8',
        env: {...process.env, COMPOSE_PROJECT_NAME: '', TEST_CONTAINERS: '', PATH: path.join(root, 'commands') + ':' + process.env.PATH, ...env}});
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');
    return {root, read, write, run};
}

for (const saved of [false, true]) {
    test('upgrade an installed Git checkout with ' + (saved ? 'a saved project' : 'a directory-derived project'), t => {
        const {root, read, write, run} = checkout(t);
        const project = saved ? 'client-07' : 'clientshop';
        if (saved) {
            write('.env', read('.env') + 'COMPOSE_PROJECT_NAME=' + project + '\n');
            write('.runtime/compose-project-name', project + '\n');
        }
        const env = read('.env');
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = run();
            assert.equal(result.status, 0, result.stderr);
        }
        assert.equal(read('.env'), env);
        assert.equal(read('compose/.runtime/compose-project-name'), project + '\n');
        assert.match(read('compose/.env'), new RegExp('COMPOSE_PROJECT_NAME=' + project + '\n'));
        assert.match(read('compose/.env'), /APPLICATION_HTTPS_PORT=8443/);
        assert.equal(fs.statSync(path.join(root, 'compose/.env')).mode & 0o777, 0o600);
        for (const file of ['.runtime/installed', '.runtime/install-profile', 'env/composer.env', 'bin/start',
            'src/app/etc/env.php', 'src/vendor/autoload.php', 'src/app/code/Client/Extra.php', 'coverage/index.html',
            'cypress/e2e/local.cy.js', 'lib/docker.sh', 'compose.versions.yaml', 'rootCA.pem', 'policies.json', 'node_modules/module/index.js']) {
            assert.equal(read('compose/' + file), read(file));
        }
        assert.ok(fs.statSync(path.join(root, 'compose/bin/start')).mode & 0o100);
        assert.equal(fs.readlinkSync(path.join(root, 'compose/src/pub/media/link')), 'fixture');
        assert.equal(read('compose/src/app/code/Client/Module.php'), 'updated tracked module');
    });
}

test('an older installation without dotenv keeps the original default project', t => {
    const {root, read, run} = checkout(t);
    fs.unlinkSync(path.join(root, '.env'));
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(read('compose/.env'), 'COMPOSE_PROJECT_NAME=magelens\n');
    assert.equal(read('compose/.runtime/compose-project-name'), 'magelens\n');
    assert.ok(!fs.existsSync(path.join(root, '.env')));
});

test('refuse old containers, active workflows and conflicting paths before copying', t => {
    const {root, read, write, run} = checkout(t);
    const busy = run({TEST_CONTAINERS: 'abc123 ' + root});
    assert.notEqual(busy.status, 0);
    assert.match(busy.stderr, /abc123/);
    fs.mkdirSync(path.join(root, '.runtime/workflow.lock'));
    const locked = run();
    assert.notEqual(locked.status, 0);
    assert.match(locked.stderr, /lock/);
    fs.rmdirSync(path.join(root, '.runtime/workflow.lock'));
    write('src/app/code/Client/Module.php', 'different local implementation');
    const collision = run();
    assert.notEqual(collision.status, 0);
    assert.match(collision.stderr, /src\/app\/code\/Client\/Module.php/);
    assert.equal(read('compose/src/app/code/Client/Module.php'), 'updated tracked module');
    assert.ok(!fs.existsSync(path.join(root, 'compose/src/vendor')));
    assert.ok(!fs.existsSync(path.join(root, 'compose/.env')));
});
