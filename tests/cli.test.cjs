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
        'exec -T runner node bin/run-cli.cjs') node bin/run-cli.cjs ;;
        *'/cli-command.php '*) node bin/fixture.cjs ;;
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
    return {root, write, run: () => spawnSync('bash', ['bin/cli-relay'], {
        cwd: root, env: process.env, encoding: 'utf8', timeout: 5000,
    }), results: () => JSON.parse(fs.readFileSync(path.join(root, 'coverage/cli-results.json'), 'utf8'))};
}

test('CLI relay preserves arguments and routes runner-independent specs through the same PHP executor', t => {
    const fixture = suite(t);
    fixture.write('bin/n98-magerun2', '#!/bin/bash\n[[ "$MAGELENS_MAGERUN_PREPARE" == 1 ]]\n');
    fs.chmodSync(path.join(fixture.root, 'bin/n98-magerun2'), 0o755);
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
test('MageRun command', async () => {
    const args = ['sys:cron:run', 'example_job'];
    const result = await magerun(args, {expectedExitCode: 2});
    assert.equal(result.code, 2);
    assert.deepEqual(JSON.parse(result.stdout).args, args);
});
`);
    fixture.write('coverage.config.json', JSON.stringify({vendorRoots: ['vendor/acme/module-orders']}));
    fixture.write('src/vendor/acme/module-orders/Test/Cli/orders.test.cjs', `
const {test, magento} = require(process.cwd() + '/cli/support.cjs');
test('vendor command', () => magento(['list']));
`);
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stderr, /Test diagnostics go to stderr/);
    assert.equal(result.stdout, '');
    const results = fixture.results();
    assert.equal(results.totalPassed, 3);
    assert.equal(results.commands, 3);
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

test('CLI coverage verifier requires handler evidence from MageRun even when PHP shows a hit', t => {
    const {root, write} = suite(t);
    const run = 'a'.repeat(32);
    const moduleRoot = 'app/code/MageLens/Compatibility';
    const probe = `${moduleRoot}/Cli/Probe.php`;
    const jobs = `${moduleRoot}/Cli/Jobs.php`;
    write(`src/${probe}`, 'writeln(trim($value))');
    write(`src/${jobs}`, [
        "getValue('magelens_probe/cron/enabled')",
        'file_put_contents(self::marker',
        "$schedule->setMessages($this->config->getValue('magelens_probe/cron/magerun_message'))",
    ].join('\n'));
    write('coverage/cli-results.json', JSON.stringify({run, commands: 2}));
    write('coverage/php/coverage-summary.json', JSON.stringify({run, commands: [
        {run, commandId: 'native', tool: 'magento'}, {run, commandId: 'named', tool: 'magerun'},
    ]}));
    write('coverage/php/line-coverage.json', JSON.stringify({[probe]: {1: 1}, [jobs]: {1: 1, 2: 1, 3: 1}}));
    const files = [
        {path: `${moduleRoot}/etc/config.xml`, declarations: [
            {path: 'magelens_probe/cron/magerun_message', id: 'message', state: 'covered'},
            {path: 'magelens_probe/cron/enabled', id: 'enabled', state: 'covered'},
            {path: 'magelens_probe/cron/unused', state: 'uncovered'},
        ]},
        {path: `${moduleRoot}/etc/crontab/di.xml`, declarations: [
            {family: 'arguments', binding: {argument: 'expected'}, id: 'expected', areas: {crontab: {state: 'covered'}}},
        ]},
    ];
    const native = {id: 'native', tool: 'magento', events: [
        {id: 'enabled'}, {id: 'expected', type: 'argument-applied', area: 'crontab'},
    ]};
    const message = {id: 'message', type: 'config-read'};
    const verify = requests => {
        write('coverage/xml/coverage.json', JSON.stringify({run, files, requests}));
        return spawnSync(process.execPath, [path.join(__dirname, 'verify-cli-coverage.cjs')], {cwd: root, encoding: 'utf8'});
    };
    const nativeOnly = verify([{...native, events: [...native.events, message]}]);
    assert.equal(nativeOnly.status, 1);
    assert.match(nativeOnly.stderr, /MageRun must execute the named cron handler/);
    const covered = verify([native, {id: 'named', tool: 'magerun', events: [message]}]);
    assert.equal(covered.status, 0, covered.stderr);
});

test('CLI relay prepares the Mark Shust cache only when a spec invokes MageRun', t => {
    const fixture = suite(t);
    const native = `
const {test, magento, magerun} = require('../support.cjs');
test('native command', () => magento(['list']));
`;
    fixture.write('cli/e2e/example.test.cjs', native);
    const nativeOnly = fixture.run();
    assert.equal(nativeOnly.status, 0, nativeOnly.stderr);
    fixture.write('cli/e2e/example.test.cjs', native + `
test('named command', () => magerun(['sys:cron:run', 'example_job'], {expectedExitCode: 2}));
`);
    const outdated = fixture.run();
    assert.equal(outdated.status, 1, outdated.stderr || outdated.error?.message);
    assert.match(outdated.stderr, /Rerun .\/install\.sh/);
    fixture.write('bin/n98-magerun2', '#!/bin/bash\n[[ "$MAGELENS_MAGERUN_PREPARE" == 1 ]] && touch prepared\n');
    fs.chmodSync(path.join(fixture.root, 'bin/n98-magerun2'), 0o755);
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(fixture.root, 'prepared')));
});
