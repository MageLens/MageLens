// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const installer = path.resolve(__dirname, '../docker/php/install-dev-tools.sh');

function workspace(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-admin-auth-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    fs.mkdirSync(`${directory}/commands`);
    fs.writeFileSync(`${directory}/commands/composer`, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args[0] === 'show') process.exit(fs.existsSync('installed') ? 0 : 1);
if (args[0] !== 'require' || fs.existsSync('fail')) process.exit(1);
fs.writeFileSync('installed', '');
`, {mode: 0o755});
    const run = () => spawnSync('bash', [installer], {cwd: directory, encoding: 'utf8',
        env: {...process.env, PATH: `${directory}/commands:${process.env.PATH}`}});
    const calls = () => fs.readFileSync(`${directory}/calls.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
    return {directory, run, calls};
}

test('Admin development dependency is installed once and existing versions are preserved', t => {
    const fixture = workspace(t);
    assert.equal(fixture.run().status, 0);
    assert.equal(fixture.run().status, 0);
    const installs = fixture.calls().filter(args => args[0] === 'require');
    assert.equal(installs.length, 1);
    assert.deepEqual(installs[0], ['require', '--dev', 'markshust/magento2-module-disabletwofactorauth',
        '--prefer-dist', '--no-interaction', '--no-progress']);
});

test('Composer failure stops Admin development setup', t => {
    const fixture = workspace(t);
    fs.writeFileSync(`${fixture.directory}/fail`, '');
    assert.notEqual(fixture.run().status, 0);
    assert.equal(fs.existsSync(`${fixture.directory}/installed`), false);
});
