// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {repository, projectFile} = require('./project-path.cjs');

function workspace(t) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-upgrade-')));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    return root;
}

test('legacy generated files stay ignored after upgrading and git add -A stages only new project sources', t => {
    const root = workspace(t);
    const write = (file, value) => {
        fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
        fs.writeFileSync(path.join(root, file), value);
    };
    // These represent ignored files left in place by switching an existing checkout.
    for (const file of ['.env', 'env/composer.env', 'src/app/etc/env.php', 'src/vendor/autoload.php',
        'lib/docker.sh', 'bin/magento', 'compose.versions.yaml', 'rootCA.pem', 'policies.json',
        '.runtime/state', '.nyc_output/out.json', 'coverage/index.html', 'cypress/screenshots/failure.png',
        'cypress/videos/run.mp4', 'compose/.env', 'compose/src/app/etc/env.php']) write(file, 'synthetic private data');
    write('.gitignore', fs.readFileSync(path.join(repository, '.gitignore')));
    write('compose/.gitignore', fs.readFileSync(projectFile('.gitignore')));
    const source = 'compose/src/app/code/Client/Module/Model.php';
    write(source, '<?php // synthetic application source');
    execFileSync('git', ['init', '--quiet'], {cwd: root});
    const expected = ['.gitignore', 'compose/.gitignore', source].sort();
    const status = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
    assert.deepEqual(status.sort(), expected);
    execFileSync('git', ['add', '-A'], {cwd: root});
    assert.deepEqual(execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean).sort(), expected);
});

test('coverage-scope mounts existing maintainer tests for both browser and PHP checks', t => {
    const root = workspace(t);
    const preload = path.join(root, 'docker-boundary.cjs');
    const log = path.join(root, 'calls.json');
    fs.writeFileSync(preload, `
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const child = require('node:child_process');
const calls = [];
child.execFileSync = (command, args) => {
    if (command === 'bash') return JSON.stringify({name: 'scope', services: {
        runner: {image: 'runner', volumes: [{target: '/workspace/node_modules', source: 'modules'}]},
        phpfpm: {image: 'php'}}, volumes: {modules: {name: 'scope_modules'}}});
    assert.equal(command, 'docker');
    const mounts = args.filter(arg => arg.startsWith('type=bind,')).map(arg => Object.fromEntries(arg.split(',').map(part => part.split('='))));
    for (const mount of mounts) assert.ok(fs.existsSync(mount.source), 'Missing bind source: ' + mount.source);
    const tests = mounts.find(mount => mount.target === '/tests');
    assert.equal(tests.source, ${JSON.stringify(__dirname)});
    calls.push(args);
    if (calls.length === 1) {
        const workspace = mounts.find(mount => mount.target === '/workspace').source;
        fs.mkdirSync(path.join(workspace, '.runtime'), {recursive: true});
        fs.writeFileSync(path.join(workspace, '.runtime/project.json'), '{}');
        fs.writeFileSync(path.join(workspace, '.runtime/coverage.ini'), '');
    }
    fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(calls));
};
`);
    execFileSync(process.execPath, ['--require', preload, path.join(__dirname, 'coverage-scope.cjs')], {cwd: repository, stdio: 'pipe'});
    const calls = JSON.parse(fs.readFileSync(log));
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(args => args.slice(-2)), [
        ['/tests/coverage-scope.cjs', 'browser'], ['php', '/tests/coverage-scope.php']
    ]);
});
