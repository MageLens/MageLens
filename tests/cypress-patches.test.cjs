// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const script = path.resolve(__dirname, '../docker/php/cypress-patches.sh');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-patches-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const root = path.join(directory, 'source');
    const patches = path.join(directory, 'patches');
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(patches, 'retired'), {recursive: true});
    for (const [file, patch] of [['session.txt', 'session.patch'], ['form.txt', 'retired/form.patch']]) {
        fs.writeFileSync(path.join(root, file), 'original\n');
        fs.writeFileSync(path.join(patches, patch),
            `--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-original\n+patched\n`);
    }
    const run = action => spawnSync('bash', [script, action], {encoding: 'utf8',
        env: {...process.env, MAGENTO_ROOT: root, CYPRESS_PATCHES_DIR: patches}});
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');
    const write = (file, content) => fs.writeFileSync(path.join(root, file), content);
    return {run, read, write, patches};
}

test('only active patches are applied, repeated runs and cleanup restore originals', t => {
    const {run, read} = fixture(t);
    for (const action of ['apply', 'apply', 'revert', 'revert']) {
        const result = run(action);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(read('session.txt'), action === 'apply' ? 'patched\n' : 'original\n');
        assert.equal(read('form.txt'), 'original\n');
    }
});

test('an old active copy left by extracting an upgrade is never reapplied', t => {
    const {run, read, patches} = fixture(t);
    fs.copyFileSync(path.join(patches, 'retired/form.patch'), path.join(patches, 'form.patch'));
    assert.equal(run('apply').status, 0);
    assert.equal(read('form.txt'), 'original\n');
    assert.equal(read('session.txt'), 'patched\n');
    assert.equal(run('revert').status, 0);
    assert.equal(read('form.txt'), 'original\n');
});

for (const action of ['apply', 'revert']) {
    test(`${action} recovers a retired patch left by an interrupted older run`, t => {
        const {run, read, write} = fixture(t);
        write('form.txt', 'patched\n');
        write('session.txt', 'patched\n');
        const result = run(action);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Restored retired Cypress-only patch/);
        assert.equal(read('form.txt'), 'original\n');
        assert.equal(read('session.txt'), action === 'apply' ? 'patched\n' : 'original\n');
    });

    test(`${action} preserves conflicting edits instead of overwriting retired patch targets`, t => {
        const {run, read, write} = fixture(t);
        write('form.txt', 'local changes\n');
        const result = run(action);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Cannot safely restore retired patch/);
        assert.equal(read('form.txt'), 'local changes\n');
        assert.equal(read('session.txt'), 'original\n');
    });
}

test('incompatible active patches fail without changing the target', t => {
    const {run, read, write} = fixture(t);
    write('session.txt', 'local changes\n');
    assert.equal(run('apply').status, 1);
    assert.equal(run('revert').status, 1);
    assert.equal(read('session.txt'), 'local changes\n');
});

test('invalid actions cannot restore retired patches, even when no active patches exist', t => {
    const {run, read, write, patches} = fixture(t);
    fs.rmSync(path.join(patches, 'session.patch'));
    write('form.txt', 'patched\n');
    assert.equal(run('invalid').status, 2);
    assert.equal(read('form.txt'), 'patched\n');
});

test('Magento framework patches apply to Mage-OS and restore its original source', t => {
    const {run, read, write, patches} = fixture(t);
    const framework = 'vendor/mage-os/framework';
    const root = path.join(patches, '../source');
    fs.mkdirSync(path.join(root, framework, 'Component'), {recursive: true});
    fs.mkdirSync(path.join(root, framework, 'Session'), {recursive: true});
    write(`${framework}/Component/ComponentRegistrar.php`, '<?php\n');
    write(`${framework}/Session/SessionManager.php`, 'original\n');
    fs.writeFileSync(path.join(patches, 'session.patch'),
        '--- a/vendor/magento/framework/Session/SessionManager.php\n+++ b/vendor/magento/framework/Session/SessionManager.php\n@@ -1 +1 @@\n-original\n+patched\n');
    for (const action of ['apply', 'apply', 'revert', 'revert']) {
        const result = run(action);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(read(`${framework}/Session/SessionManager.php`), action === 'apply' ? 'patched\n' : 'original\n');
        assert.equal(fs.existsSync(path.join(root, 'vendor/magento')), false);
    }
});
