// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const helper = path.resolve(__dirname, '../bin/application-domain');

function fixture(t, content = 'COMPOSE_PROJECT_NAME=customer\nAPPLICATION_HTTPS_PORT=8443\n') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-domain-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const file = path.join(directory, '.env');
    fs.writeFileSync(file, content);
    const run = (domain = '', env = {}) => spawnSync('bash', ['-eu', '-c',
        'source "$1"; configure_application_domain "$2" "$3"; printf "%s" "$APPLICATION_DOMAIN"',
        'test', helper, file, domain], {encoding: 'utf8', env: {...process.env, APPLICATION_DOMAIN: '', ...env}});
    return {file, run};
}

test('domain defaults to magelens.test and preserves project settings on reruns', t => {
    const {file, run} = fixture(t);
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, 'magelens.test');
    const saved = fs.readFileSync(file, 'utf8');
    assert.match(saved, /^COMPOSE_PROJECT_NAME=customer$/m);
    assert.match(saved, /^APPLICATION_HTTPS_PORT=8443$/m);
    assert.equal(run().stdout, 'magelens.test');
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
});

test('selected domain is normalized and reused; an explicit argument can change it', t => {
    const {file, run} = fixture(t, 'APPLICATION_DOMAIN="Existing.test" # local shop\nCOMPOSE_PROJECT_NAME=customer\n');
    assert.equal(run().stdout, 'existing.test');
    assert.equal(run('', {APPLICATION_DOMAIN: 'env.test'}).stdout, 'env.test');
    assert.equal(run('SHOP.Magelens.test', {APPLICATION_DOMAIN: 'env.test'}).stdout, 'shop.magelens.test');
    assert.equal(run().stdout, 'shop.magelens.test');
    assert.equal(fs.readFileSync(file, 'utf8').match(/^APPLICATION_DOMAIN=/gm).length, 1);
});

test('invalid domain input cannot modify the saved configuration', t => {
    const {file, run} = fixture(t);
    const original = fs.readFileSync(file, 'utf8');
    for (const domain of ['https://shop.test', 'shop.test:8443', 'shop.test/path', '-shop.test',
        'shop..test', 'shop_.test', '$(id).test', `${'a'.repeat(64)}.test`]) {
        const result = run(domain);
        assert.notEqual(result.status, 0, domain);
        assert.match(result.stderr, /Enter a domain name/);
        assert.equal(fs.readFileSync(file, 'utf8'), original);
    }
});
