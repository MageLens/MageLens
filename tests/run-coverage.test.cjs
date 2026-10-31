// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function workflow(t, args = [], failure = '', interrupted = false, runner = 'cypress', installedVersion = '3') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-workflow-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    for (const name of ['bin', '.runtime', 'coverage']) fs.mkdirSync(path.join(directory, name));
    fs.copyFileSync(path.resolve(__dirname, '../bin/run-coverage'), path.join(directory, 'bin/run-coverage'));
    fs.writeFileSync(path.join(directory, '.runtime/installed'), installedVersion + '\n');
    if (interrupted) fs.writeFileSync(path.join(directory, '.runtime/hooks-active'), '');
    fs.writeFileSync(path.join(directory, 'bin/common'), `
set -euo pipefail
ROOT=$PWD
MAGELENS_RUNNER=${runner}
preflight() { :; }
say() { :; }
fail() { echo "$*" >&2; exit 1; }
lock_workflow() { mkdir .runtime/workflow.lock; }
dc() {
    printf '%s\\n' "$*" >> calls
    case "$*" in
        *theme-scope.php) echo '[]' ;;
        *project-hooks.php\\ prepare) echo '{}' ;;
        *collection.php\\ start) touch coverage/.active-run ;;
        *collection.php\\ stop|*report.php) rm -f coverage/.active-run ;;
        *run-browser.cjs\\ --warmup|*run-playwright.cjs\\ --warmup) [[ "$TEST_FAILURE" != warmup ]] || return 124 ;;
        *run-browser.cjs|*run-playwright.cjs) [[ "$TEST_FAILURE" != tests ]] || return 23 ;;
    esac
}
`);
    const result = spawnSync('bash', ['bin/run-coverage', ...args], {
        cwd: directory, encoding: 'utf8', env: {...process.env, TEST_FAILURE: failure},
    });
    const calls = fs.existsSync(path.join(directory, 'calls')) ? fs.readFileSync(path.join(directory, 'calls'), 'utf8') : '';
    assert.equal(fs.existsSync(path.join(directory, '.runtime/workflow.lock')), false);
    assert.equal(fs.existsSync(path.join(directory, 'coverage/.active-run')), false);
    return {...result, calls, directory};
}

for (const runner of ['cypress', 'playwright']) {
const browserScript = runner === 'cypress' ? 'run-browser.cjs' : 'run-playwright.cjs';
test(`${runner}: default run preserves running services, configuration and caches`, t => {
    const result = workflow(t, [], '', false, runner);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.calls, /^(up|run|stop|restart) |cache:|config:set|refresh-assets|base-url/m);
    assert.equal((result.calls.match(/project-hooks.php cleanup/g) || []).length, 1);
    assert.match(result.calls, /report.php/);
    assert.match(result.calls, /finalize.cjs/);
    const ordered = ['prepare.cjs', 'project-hooks.php before', 'project-hooks.php prepare',
        `timeout --signal=TERM --kill-after=10s 600s node bin/${browserScript} --warmup`,
        'manifest.php', 'collection.php start', `runner node bin/${browserScript}\n`, 'report.php'];
    for (const command of ordered) assert.ok(result.calls.includes(command), `Missing command: ${command}`);
    for (let index = 1; index < ordered.length; index++) {
        assert.ok(result.calls.indexOf(ordered[index - 1]) < result.calls.indexOf(ordered[index]), `${ordered[index - 1]} must precede ${ordered[index]}`);
    }
});

test(`${runner}: refreshes run only when requested`, t => {
    const result = workflow(t, ['--start', '--refresh-assets', '--refresh-cache', '--restart-php'], '', false, runner);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, /^up /m);
    assert.match(result.calls, /^restart -t 60 phpfpm$/m);
    assert.match(result.calls, /refresh-assets.sh/);
    assert.doesNotMatch(result.calls, /cache:clean/, 'Asset refresh already cleans caches');
    const cache = workflow(t, ['--refresh-cache'], '', false, runner);
    assert.match(cache.calls, /cache:clean/);
    assert.doesNotMatch(cache.calls, /refresh-assets.sh/);
});

test(`${runner}: failed tests close collection and clean fixtures without publishing reports`, t => {
    const result = workflow(t, [], 'tests', true, runner);
    assert.equal(result.status, 23, result.stderr);
    assert.equal((result.calls.match(/project-hooks.php cleanup/g) || []).length, 2, 'Recover interrupted fixtures and clean current fixtures');
    assert.equal((result.calls.match(/collection.php stop/g) || []).length, 2);
    assert.doesNotMatch(result.calls, /report.php|finalize.cjs/);
    assert.equal(fs.existsSync(path.join(result.directory, '.runtime/hooks-active')), false);
});

test(`${runner}: warm-up timeout cleans hooks before collection and does not run tests or reports`, t => {
    const result = workflow(t, [], 'warmup', false, runner);
    assert.equal(result.status, 124, result.stderr);
    assert.match(result.stderr, /exceeded its 10-minute limit/);
    assert.match(result.stderr, /warmup-diagnostics.json/);
    assert.equal((result.calls.match(/project-hooks.php cleanup/g) || []).length, 1);
    assert.doesNotMatch(result.calls, /collection.php start|runner node bin\/run-(browser|playwright).cjs\n|manifest.php|report.php|finalize.cjs/);
    assert.equal(fs.existsSync(path.join(result.directory, '.runtime/hooks-active')), false);
});

test(`${runner}: old installations require an update before launching a headed browser`, t => {
    const result = workflow(t, [], '', false, runner, '2');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /theme and runner flags/);
    assert.equal(result.calls, '');
});
}

test('help and invalid options do not touch the environment', t => {
    assert.equal(workflow(t, ['--help']).calls, '');
    const result = workflow(t, ['--unknown']);
    assert.equal(result.status, 1);
    assert.equal(result.calls, '');
});


test('coverage uses the installed Playwright runner without a command-line override', t => {
    const result = workflow(t, [], '', false, 'playwright');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, /run-playwright.cjs --warmup/);
    assert.match(result.calls, /runner node bin\/run-playwright.cjs\n/);
    assert.doesNotMatch(result.calls, /run-browser.cjs/);
});

test('coverage refuses an uninstalled runner before touching services or collection', t => {
    for (const [installed, requested] of [['cypress', 'playwright'], ['playwright', 'cypress']]) {
        const result = workflow(t, ['--runner=' + requested], '', false, installed);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /not installed/);
        assert.equal(result.calls, '');
    }
});
