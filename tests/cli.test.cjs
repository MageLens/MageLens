// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function suite(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cli-tests-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    for (const file of ['bin/cli-relay', 'bin/run-cli.cjs', 'bin/project.cjs', 'cli/support.cjs']) {
        fs.mkdirSync(path.join(root, path.dirname(file)), {recursive: true});
        fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
    }
    fs.mkdirSync(path.join(root, 'coverage'));
    fs.writeFileSync(path.join(root, 'coverage/run.json'), JSON.stringify({id: 'a'.repeat(32)}));
    fs.writeFileSync(path.join(root, 'bin/common'), `
set -euo pipefail
fail() { printf '%s\\n' "$*" >&2; exit 1; }
dc() {
    case "$*" in
        *' bin/run-cli.cjs') node bin/run-cli.cjs ;;
        *' cli-command.php'|*'/cli-command.php') node bin/fixture.cjs ;;
        *) return 1 ;;
    esac
}
`);
    fs.writeFileSync(path.join(root, 'bin/fixture.cjs'), `
const request = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify({code: request.tool === 'magerun' ? 2 : 0, stderr: '', stdout: JSON.stringify(request)}));
`);
    const write = (file, contents) => {
        fs.mkdirSync(path.join(root, path.dirname(file)), {recursive: true});
        fs.writeFileSync(path.join(root, file), contents);
    };
    return {write, run: () => spawnSync('bash', ['bin/cli-relay'], {
        cwd: root, env: process.env, encoding: 'utf8', timeout: 5000,
    }), results: () => JSON.parse(fs.readFileSync(path.join(root, 'coverage/cli-results.json'), 'utf8'))};
}

test('CLI relay preserves arguments and routes runner-independent specs through the same PHP executor', t => {
    const fixture = suite(t);
    fixture.write('src/app/code/Example/Module/etc/module.xml', '<module name="Example_Module"/>');
    fixture.write('src/app/code/Example/Module/Test/Cli/example.test.cjs', `
const assert = require('node:assert/strict');
const {test, magento} = require('../../../../../../../cli/support.cjs');
test('module command', async () => {
    const args = ['cron:run', '--group=example', 'literal spaces " and $'];
    const result = await magento(args, {timeout: 7500});
    assert.deepEqual(JSON.parse(result.stdout), {run: 'a'.repeat(32), tool: 'magento', args, timeout: 7500});
    process.stdout.write('Test diagnostics go to stderr.\\n');
});
`);
    fixture.write('cli/e2e/example.test.cjs', `
const assert = require('node:assert/strict');
const {test, magerun} = require('../support.cjs');
test('database command', async () => {
    const result = await magerun(['db:query', 'SELECT "one"'], {expectedExitCode: 2});
    assert.equal(result.code, 2);
});
`);
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stderr, /Test diagnostics go to stderr/);
    assert.equal(result.stdout, '');
    const results = fixture.results();
    assert.equal(results.totalPassed, 2);
    assert.equal(results.commands, 2);
});

test('CLI relay keeps projects without CLI specs working and rejects a spec that registers no tests', t => {
    const fixture = suite(t);
    const empty = fixture.run();
    assert.equal(empty.status, 0, empty.stderr || empty.error?.message);
    assert.equal(fixture.results().totalTests, 0);
    fixture.write('cli/e2e/skipped.test.cjs', "");
    const missing = fixture.run();
    assert.equal(missing.status, 1, missing.stderr || missing.error?.message);
    assert.match(missing.stderr, /registered no tests/);
});
