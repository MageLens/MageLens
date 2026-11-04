// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function prepare(t, auth) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-auth-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/credentials.cjs')], {
        encoding: 'utf8', env: {RUNNER_TEMP: directory, COMPOSER_AUTH: auth}
    });
    return {result, file: path.join(directory, 'auth.json')};
}

test('CI prepares only Marketplace auth without requiring environment-review metadata', t => {
    const marketplace = {username: 'test-public-key', password: 'test-private-key'};
    const {result, file} = prepare(t, JSON.stringify({'http-basic': {
        'repo.magento.com': marketplace, 'unrelated.example': {username: 'unrelated', password: 'exclude-me'}
    }, 'github-oauth': {'github.com': 'exclude-this-too'}}));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), {'http-basic': {'repo.magento.com': marketplace}});
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.match(result.stdout, /::add-mask::test-public-key/);
    assert.match(result.stdout, /::add-mask::test-private-key/);
    assert.doesNotMatch(result.stdout + result.stderr, /exclude-me|exclude-this-too/);
});

test('CI rejects missing, malformed and incomplete Marketplace credentials before writing a file', t => {
    for (const auth of ['', 'not-json', '{}', '{"http-basic":{"repo.magento.com":{"username":"test-public-key"}}}']) {
        const {result, file} = prepare(t, auth);
        assert.notEqual(result.status, 0);
        assert.equal(fs.existsSync(file), false);
    }
});
