// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const runId = '0123456789abcdef0123456789abcdef';
function workflow(t, args = [], failure = '', interrupted = false, runner = 'cypress', installedVersion = '6', setup = () => {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-workflow-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    for (const name of ['bin', '.runtime', 'coverage']) fs.mkdirSync(path.join(directory, name));
    for (const file of ['run-coverage', 'public-report.cjs']) {
        fs.copyFileSync(projectFile('bin', file), path.join(directory, 'bin', file));
    }
    fs.writeFileSync(path.join(directory, '.runtime/installed'), installedVersion + '\n');
    if (interrupted) fs.writeFileSync(path.join(directory, '.runtime/hooks-active'), '');
    fs.writeFileSync(path.join(directory, 'bin/cli-relay'), `#!/usr/bin/env bash
echo cli-relay >> calls
[[ "$TEST_FAILURE" != cli && "$TEST_FAILURE" != both ]]
`, {mode: 0o755});
    fs.writeFileSync(path.join(directory, 'bin/common'), `
set -euo pipefail
ROOT=$PWD
MAGELENS_RUNNER=${runner}
preflight() { :; }
say() { printf '%s\\n' \"$*\"; }
fail() { echo "$*" >&2; exit 1; }
lock_workflow() { mkdir .runtime/workflow.lock; trap 'rmdir .runtime/workflow.lock' EXIT; }
dc() {
    printf '%s\\n' "$*" >> calls
    case "$*" in
        *report-url.php) [[ "$TEST_FAILURE" != url ]] || return 1; echo 'http://custom.test:8080/shop/media/coverage/index.html' ;;
        *public-report.cjs) [[ "$TEST_FAILURE" != staging ]] || return 1; node bin/public-report.cjs ;;
        *project-hooks.php\\ cleanup) [[ "$TEST_FAILURE" != cleanup ]] || return 1 ;;
        *prepare.cjs*) rm -rf coverage; mkdir coverage; test ! -L src/pub/media/coverage
            printf '{"runner":"${runner}","sources":{},"id":"%s"}' "$RUN_ID" > coverage/run.json ;;
        exec\\ -T\\ runner\\ node\\ -p\\ *) [[ "$TEST_FAILURE" != run-id ]] || return 1; shift 3; "$@" ;;
        *report-browser.cjs*) [[ "$TEST_FAILURE" != browser-report && "$TEST_FAILURE" != xml-report && "$TEST_FAILURE" != finalize && "$TEST_FAILURE" != tests+finalize ]] || return 1
            printf '<html>current</html>' > coverage/index.html; echo '{}' > coverage/summary.json ;;
        *theme-scope.php) echo '[]' ;;
        *project-hooks.php\\ prepare) echo '{}' ;;
        *collection.php\\ start) touch coverage/.active-run ;;
        *collection.php\\ stop) rm -f coverage/.active-run ;;
        *report.php) [[ "$TEST_FAILURE" != php-report ]] || return 1 ;;
        *xml-manifest.php\\ check) [[ "$TEST_FAILURE" != xml-provenance ]] || return 1 ;;
        *app\\ test*) [[ "$TEST_FAILURE" != publish && "$TEST_FAILURE" != tests+publish ]] || return 1 ;;
        *app\\ sh*) [[ "$TEST_FAILURE" != mount ]] || return 1 ;;
        *run-browser.cjs\\ --warmup|*run-playwright.cjs\\ --warmup) [[ "$TEST_FAILURE" != warmup ]] || return 124 ;;
        *run-browser.cjs|*run-playwright.cjs) case "$TEST_FAILURE" in
            tests|both|tests+finalize|tests+publish) return 23 ;;
            interrupt) return 130 ;;
            terminate) return 143 ;;
            signal) kill -INT $$; return 1 ;;
            term-signal) sh -c 'echo $$ > term-child; sleep 0.2; kill -TERM $PPID; exec sleep 30' </dev/null >/dev/null 2>&1; return 1 ;;
        esac ;;
    esac
}
`);
    setup(directory);
    const started = Date.now();
    const result = spawnSync('bash', ['bin/run-coverage', ...args], {
        cwd: directory, encoding: 'utf8', env: {...process.env, TEST_FAILURE: failure, RUN_ID: runId},
    });
    const child = path.join(directory, 'term-child');
    // The suite child outlives a script ended by TERM; stop it.
    if (fs.existsSync(child)) try { process.kill(Number(fs.readFileSync(child, 'utf8'))); } catch {}
    const calls = fs.existsSync(path.join(directory, 'calls')) ? fs.readFileSync(path.join(directory, 'calls'), 'utf8') : '';
    assert.equal(fs.existsSync(path.join(directory, '.runtime/workflow.lock')), false);
    assert.equal(fs.existsSync(path.join(directory, 'coverage/.active-run')), false);
    // The success URL is printed exactly when the report is published, including after failed tests.
    const link = path.join(directory, 'src/pub/media/coverage');
    const published = fs.lstatSync(link, {throwIfNoEntry: false})?.isSymbolicLink() === true && fs.readlinkSync(link) === '../../../coverage/.site';
    assert.equal(/Open the combined coverage report:|http:\/\/custom/.test(result.stdout), published);
    if (published) assert.ok(result.status === 0 || /Tests failed in the/.test(result.stderr), result.stderr);
    return {...result, calls, directory, duration: Date.now() - started};
}

for (const runner of ['cypress', 'playwright']) {

test(`${runner}: README flag reaches preparation and finalization only when requested`, t => {
    const defaultRun = workflow(t, [], '', false, runner);
    assert.equal(defaultRun.status, 0, defaultRun.stderr);
    assert.doesNotMatch(defaultRun.calls, /--update-readme/);
    const optedIn = workflow(t, ['--update-readme', '--start'], '', false, runner);
    assert.equal(optedIn.status, 0, optedIn.stderr);
    assert.match(optedIn.calls, /prepare\.cjs --theme-roots \.runtime\/active-themes\.json --update-readme/);
    assert.match(optedIn.calls, /finalize\.cjs "\$@".* sh --update-readme/);
});

test(`${runner}: the coverage database is requested from finalization only with its flag`, t => {
    const defaultRun = workflow(t, [], '', false, runner);
    assert.equal(defaultRun.status, 0, defaultRun.stderr);
    assert.doesNotMatch(defaultRun.calls, /--include-machine-report/);
    const optedIn = workflow(t, ['--include-machine-report', '--update-readme'], '', false, runner);
    assert.equal(optedIn.status, 0, optedIn.stderr);
    assert.match(optedIn.calls, /finalize\.cjs "\$@".* sh --update-readme --include-machine-report/);
    assert.doesNotMatch(optedIn.calls, /prepare\.cjs.*--include-machine-report/);
});

test(`${runner}: publishes complete reports after cleanup`, t => {
    const result = workflow(t, [], '', false, runner);
    assert.equal(result.status, 0, result.stderr);
    const link = path.join(result.directory, 'src/pub/media/coverage');
    assert.equal(fs.readlinkSync(link), '../../../coverage/.site');
    assert.equal(fs.readFileSync(path.join(link, 'index.html'), 'utf8'), '<html>current</html>');
    assert.ok(fs.existsSync(path.join(link, 'summary.json')));
    assert.ok(fs.existsSync(path.join(result.directory, 'coverage/project-fixtures.json')));
    assert.equal(fs.existsSync(path.join(link, 'project-fixtures.json')), false);
    assert.match(result.stdout, /Open the combined coverage report: http:\/\/custom.test:8080\/shop\/media\/coverage\/index.html/);
    assert.doesNotMatch(result.stdout, /Local report:/);
    assert.ok(result.calls.lastIndexOf('project-hooks.php cleanup') < result.calls.indexOf('report-url.php'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.directory, 'coverage/suite-status.json'))), {run: runId, [runner]: 0, cli: 0});
});

for (const failure of ['mount', 'warmup', 'interrupt', 'terminate', 'signal', 'term-signal', 'run-id', 'php-report', 'xml-provenance', 'browser-report', 'xml-report', 'finalize', 'cleanup', 'url', 'staging', 'publish']) {
    test(`${runner}: ${failure} failure leaves no public report or success URL`, t => {
        const result = workflow(t, [], failure, false, runner, '6', directory => {
            fs.mkdirSync(path.join(directory, 'src/pub/media'), {recursive: true});
            fs.writeFileSync(path.join(directory, 'coverage/index.html'), 'old report');
            fs.symlinkSync('../../../coverage', path.join(directory, 'src/pub/media/coverage'));
        });
        assert.notEqual(result.status, 0, result.stderr);
        assert.equal(fs.existsSync(path.join(result.directory, 'src/pub/media/coverage')), false);
        if (['cleanup', 'url', 'publish'].includes(failure)) assert.equal(result.status, 1, result.stderr);
        if (failure === 'cleanup') {
            assert.ok(fs.existsSync(path.join(result.directory, '.runtime/hooks-active')), 'Failed cleanup must retain the recovery marker');
            assert.doesNotMatch(result.calls, /report-url.php/, 'Failed cleanup must prevent publication');
        }
        if (['interrupt', 'terminate', 'signal', 'term-signal'].includes(failure)) {
            // TERM is not trapped: it ends the run through the EXIT cleanup without waiting for the running suite.
            if (failure === 'term-signal') assert.ok(result.duration < 15000 && (result.status === 143 || result.signal === 'SIGTERM'), `${result.status} ${result.signal} ${result.duration}ms`);
            else assert.equal(result.status, failure === 'terminate' ? 143 : 130, result.stderr);
            assert.doesNotMatch(result.calls, /cli-relay|report.php|finalize.cjs/, 'An interrupted run must not continue');
        }
        if (failure === 'run-id') assert.match(result.stderr, /Cannot read the current run ID/);
        if (failure === 'url') assert.doesNotMatch(result.calls, /app test -r/, 'Invalid URL must stop publication');
    });
}

test(`${runner}: a repeated run removes obsolete report files`, t => {
    const result = workflow(t, [], '', false, runner, '6', directory => {
        fs.mkdirSync(path.join(directory, 'src/pub/media'), {recursive: true});
        fs.symlinkSync('../../../coverage', path.join(directory, 'src/pub/media/coverage'));
        fs.writeFileSync(path.join(directory, 'coverage/obsolete.html'), 'old');
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(result.directory, 'src/pub/media/coverage/obsolete.html')), false);
});

for (const kind of ['file', 'directory', 'symlink']) test(`${runner}: preserves conflicting ${kind}`, t => {
    const result = workflow(t, [], '', false, runner, '6', directory => {
        const destination = path.join(directory, 'src/pub/media/coverage');
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        if (kind === 'file') fs.writeFileSync(destination, 'keep');
        else if (kind === 'directory') fs.mkdirSync(destination);
        else fs.symlinkSync('unrelated', destination);
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Move it aside first/);
    assert.ok(fs.lstatSync(path.join(result.directory, 'src/pub/media/coverage')));
});

const browserScript = runner === 'cypress' ? 'run-browser.cjs' : 'run-playwright.cjs';
test(`${runner}: default run preserves running services, configuration and caches`, t => {
    const result = workflow(t, [], '', false, runner);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.calls, /^(up|run|stop|restart) |cache:|config:set|refresh-assets|base-url/m);
    assert.equal((result.calls.match(/project-hooks.php cleanup/g) || []).length, 1);
    assert.match(result.calls, /report.php/);
    assert.match(result.calls, /finalize.cjs/);
    const ordered = ['prepare.cjs', 'project-hooks.php before', 'project-hooks.php prepare', 'xml-manifest.php\n',
        `timeout --signal=TERM --kill-after=10s 600s node bin/${browserScript} --warmup`,
        '/php/manifest.php', 'collection.php start', `runner node bin/${browserScript}\n`, 'cli-relay', 'report.php',
        'xml-manifest.php check', 'report-xml.cjs', 'finalize.cjs', 'project-hooks.php cleanup', 'report-url.php'];
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
    assert.ok(result.calls.indexOf('bin/prepare.cjs') < result.calls.indexOf('refresh-assets.sh'),
        'Production static deployment uses the current instrumented assets');
    assert.doesNotMatch(result.calls, /cache:clean/, 'Asset refresh already cleans caches');
    const cache = workflow(t, ['--refresh-cache'], '', false, runner);
    assert.match(cache.calls, /cache:clean/);
    assert.doesNotMatch(cache.calls, /refresh-assets.sh/);
});

for (const [failure, suites] of [['tests', `the ${runner} suite`], ['cli', 'the CLI suite'], ['both', `the ${runner} suite and the CLI suite`]]) {
    test(`${runner}: failed tests in ${suites} still run every suite and publish reports, then fail the run`, t => {
        const result = workflow(t, ['--update-readme'], failure, true, runner);
        assert.equal(result.status, 1, result.stderr);
        assert.equal((result.calls.match(/project-hooks.php cleanup/g) || []).length, 2, 'Recover interrupted fixtures and clean current fixtures');
        assert.equal((result.calls.match(/collection.php stop/g) || []).length, 2);
        const ordered = [`runner node bin/${runner === 'cypress' ? 'run-browser' : 'run-playwright'}.cjs\n`, 'cli-relay', 'report.php',
            'finalize.cjs "$@" sh --update-readme', 'project-hooks.php cleanup', 'report-url.php'];
        for (let index = 1; index < ordered.length; index++) {
            assert.ok(result.calls.lastIndexOf(ordered[index - 1]) < result.calls.lastIndexOf(ordered[index]), `${ordered[index - 1]} must precede ${ordered[index]}`);
        }
        assert.equal(fs.readlinkSync(path.join(result.directory, 'src/pub/media/coverage')), '../../../coverage/.site');
        assert.match(result.stdout, /Open the combined coverage report: http:\/\/custom.test:8080/);
        assert.match(result.stderr, new RegExp(`Tests failed in ${suites}\\. The reports include their results\\.`));
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.directory, 'coverage/suite-status.json'))),
            {run: runId, [runner]: failure === 'cli' ? 0 : 23, cli: failure === 'tests' ? 0 : 1});
        assert.equal(fs.existsSync(path.join(result.directory, '.runtime/hooks-active')), false);
    });
}

for (const failure of ['tests+finalize', 'tests+publish']) test(`${runner}: ${failure} failure after failed tests says that no report was published`, t => {
    const result = workflow(t, [], failure, false, runner);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(fs.existsSync(path.join(result.directory, 'src/pub/media/coverage')), false);
    assert.match(result.stderr, /Tests failed in the (cypress|playwright) suite\. No report was published\./);
    assert.doesNotMatch(result.stderr, /include their results/);
});

test(`${runner}: warm-up timeout cleans hooks before collection and does not run tests or reports`, t => {
    const result = workflow(t, [], 'warmup', false, runner);
    assert.equal(result.status, 124, result.stderr);
    assert.match(result.stderr, /exceeded its 10-minute limit/);
    assert.match(result.stderr, /warmup-diagnostics.json/);
    assert.equal((result.calls.match(/project-hooks.php cleanup/g) || []).length, 1);
    assert.doesNotMatch(result.calls, /collection.php start|runner node bin\/run-(browser|playwright).cjs\n|\/php\/manifest.php|report.php|finalize.cjs/);
    assert.equal(fs.existsSync(path.join(result.directory, '.runtime/hooks-active')), false);
});

test(`${runner}: old installations require an update before launching a headed browser`, t => {
    for (const version of runner === 'cypress' ? ['2', '3', '4', '5'] : ['2', '3', '4', '5']) {
        const result = workflow(t, [], '', false, runner, version);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /saved platform, theme and runner flags/);
        assert.match(result.stderr, /current browser runner/);
        assert.equal(result.calls, '');
    }
});
}

test('the XML hook extension requires rebuilding an older Playwright installation', t => {
    const result = workflow(t, [], '', false, 'playwright', '4');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Rerun/);
});

test('help and invalid options do not touch the environment', t => {
    const help = workflow(t, ['--help']);
    assert.equal(help.calls, '');
    assert.match(help.stdout, /--update-readme/);
    assert.match(help.stdout, /--include-machine-report/);
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

test('local web report stages only presentation files and never follows input symlinks', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-public-report-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const coverage = path.join(root, 'coverage');
    const expected = ['index.html', 'report.sqlite', 'schema.sql', 'summary.json', 'php/clover.xml', 'php/_js/source-view.js',
        'js/base.css', 'js-application/index.html', 'templates/files/view.html', 'xml/coverage.json', 'badges/php.svg',
        'html-validation/index.html', 'html-validation/results.json'];
    const privateFiles = ['raw/php/private.json', 'raw/templates/private.html', 'raw/html-validation/private.json', 'project-fixtures.json',
        'php/coverage-summary.json', 'playwright-artifacts/trace.zip', 'share-with-source.html'];
    for (const file of [...expected, ...privateFiles]) {
        const fullPath = path.join(coverage, file);
        fs.mkdirSync(path.dirname(fullPath), {recursive: true});
        fs.writeFileSync(fullPath, file);
    }
    fs.symlinkSync('../project-fixtures.json', path.join(coverage, 'js/leak.html'));
    fs.symlinkSync('../raw', path.join(coverage, 'php/linked'));
    const run = spawnSync(process.execPath, [projectFile('bin/public-report.cjs')], {cwd: root, encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    for (const file of expected) assert.equal(fs.readFileSync(path.join(coverage, '.site', file), 'utf8'), file);
    for (const file of [...privateFiles, 'js/leak.html', 'php/linked']) {
        assert.equal(fs.existsSync(path.join(coverage, '.site', file)), false, file);
    }
});
