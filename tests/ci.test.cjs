// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {cases} = require('./ci/cases.cjs');
const {verifyCase} = require('./ci/gate.cjs');
const {sanitizedCoverage} = require('./ci/evidence.cjs');
const {writeCoverage} = require('./ci-coverage-fixture.cjs');
const {provenance} = require('../docker/runner/cypress-source/provenance.cjs');
const pins = Object.fromEntries([...fs.readFileSync(path.join(__dirname, '../dependencies.yaml'), 'utf8').matchAll(/^(\w+): "([^"]+)"$/gm)].map(m => [m[1], m[2]]));
const titles = [
    'creates a category and illustrated article, publishes, moderates comments, and deletes records',
    'validates Admin input, preserves form values, and rejects forged writes',
    'requires Admin authentication and the Blog ACL permission',
    'searches, filters, paginates, reads articles, and retains favorites',
    'rejects invalid filters and keeps draft, scheduled, and inactive-category posts private',
    'collects real PHP, JavaScript and template execution', 'starts the next test with fresh state'
];
const counts = {totalTests: 7, totalPassed: 7, totalFailed: 0, totalSkipped: 0, totalPending: 0};
function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-unit-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const write = (file, data) => {fs.mkdirSync(path.dirname(`${directory}/${file}`), {recursive: true}); fs.writeFileSync(`${directory}/${file}`, JSON.stringify(data));};
    const entry = cases[0];
    write('run.json', {id: 'fresh', runner: entry.runner, sources: {private: 'SECRET'}});
    write('installation.json', {...entry, version: pins.MAGENTO_VERSION, credential: 'SECRET', runnerBuild: provenance('x64')});
    write('cypress-runner-results.json', {browserName: 'chrome-for-testing', browserVersion: pins.CHROME_VERSION,
        cypressVersion: pins.CYPRESS_VERSION, totalTests: 11, totalPassed: 11, totalFailed: 0, totalSkipped: 0, totalPending: 0,
        build: provenance('x64')});
    const browser = {name: 'chrome-for-testing', version: pins.CHROME_VERSION};
    write(`${entry.runner}-results.json`, {run: 'fresh', browser, ...counts, tests: titles.map(title => ({title, status: 'passed', error: 'SECRET'}))});
    write('project-fixtures.json', {Application_Blog: {themePaths: ['Magento/luma'], password: 'SECRET'}});
    writeCoverage(directory);
    const evidence = {...entry, sha: 'candidate', workflowRun: '123', attempt: '1', host: 'Linux', image: 'ubuntu', imageVersion: 'today', architecture: 'x64', passed: true,
        feasibility: {passed: true, sha: 'candidate'}, steps: Object.fromEntries(['probe', 'resources', 'isolation', 'e2e', 'cleanup'].map(step => [step, {outcome: 'success'}])), dependencies: pins, counts, browser};
    return {directory, entry, evidence, context: {sha: 'candidate', run: '123', attempt: '1'}};
}
test('required matrix is eight Linux modes and Windows while macOS is deferred', () => {
    assert.equal(cases.length, 9);
    assert.equal(new Set(cases.map(c => c.id)).size, 9);
    assert.equal(cases.filter(c => c.os === 'ubuntu-latest').length, 8);
    assert.deepEqual(cases.filter(c => c.os !== 'ubuntu-latest').map(({os, platform, theme, runner}) => ({os, platform, theme, runner})), [
        {os: 'windows-latest', platform: 'mageos', theme: 'luma', runner: 'cypress'}
    ]);
});
test('artifact projection removes credentials, source, private packages and arbitrary test errors', t => {
    const {directory} = fixture(t);
    const safe = sanitizedCoverage(directory);
    assert.doesNotMatch(JSON.stringify(safe), /SECRET|password|credential|vendor\/private/);
    assert.equal(safe['php/line-coverage.json']['/shop/app/code/Application/Blog/Model/Article.php']['1'], 1);
    assert.equal(safe['cypress-results.json'].totalPassed, 7);
});
test('case gate accepts complete evidence and rejects stale, skipped, canceled and forged host evidence', t => {
    const {directory, entry, evidence, context} = fixture(t);
    assert.equal(verifyCase(entry, evidence, directory, context), 'fresh');
    for (const patch of [{passed: false}, {sha: 'older'}, {attempt: '0'}, {workflowRun: 'other'}, {host: 'Windows'},
        {browser: null}, {browser: {name: 'electron', version: pins.CHROME_VERSION}},
        {counts: {...counts, totalSkipped: 1}}, {feasibility: {passed: false}}, {steps: {...evidence.steps, cleanup: {outcome: 'cancelled'}}},
        {steps: {...evidence.steps, resources: undefined}}, {steps: {...evidence.steps, resources: {outcome: 'failure'}}}]) {
        assert.throws(() => verifyCase(entry, {...evidence, ...patch}, directory, context));
    }
});
test('final gate fails when reports are missing even if all job results claim success', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-gate-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/gate.cjs'), 'absent'], {cwd: directory, encoding: 'utf8', env: {...process.env,
        CI_SHA: 'candidate', GITHUB_STEP_SUMMARY: '', CI_NEEDS: JSON.stringify(Object.fromEntries(['static', 'integration', 'copyright', 'e2e', 'magento', 'images'].map(job => [job, {result: 'success'}])))}});
    assert.equal(result.status, 1);
    const report = JSON.parse(fs.readFileSync(`${directory}/ci-gate/qualification.json`));
    assert.equal(report.passed, false);
    assert.equal(report.completedCases, 0);
    assert.equal(report.expectedCases, 9);
    assert.equal(report.expectedAcceptanceTests, 63);
    assert.match(result.stdout, /Linux comparison incomplete/);
});
test('case gate rejects missing or incomplete runner regressions and stale source builds', t => {
    const {directory, entry, evidence, context} = fixture(t);
    const file = path.join(directory, 'cypress-runner-results.json');
    const complete = JSON.parse(fs.readFileSync(file));
    for (const patch of [{totalTests: 0}, {totalPassed: 8}, {totalFailed: 1}, {totalPending: 1}, {totalSkipped: 1},
        {cypressVersion: '16.2.0'}, {browserName: 'electron'}, {build: {...complete.build, patchSha256: 'stale'}}]) {
        fs.writeFileSync(file, JSON.stringify({...complete, ...patch}));
        assert.throws(() => verifyCase(entry, evidence, directory, context), /runner regressions|source build/);
    }
    fs.rmSync(file);
    assert.throws(() => verifyCase(entry, evidence, directory, context), /ENOENT/);
    fs.writeFileSync(file, JSON.stringify(complete));
    const installationFile = path.join(directory, 'installation.json');
    const installation = JSON.parse(fs.readFileSync(installationFile));
    delete installation.runnerBuild;
    fs.writeFileSync(installationFile, JSON.stringify(installation));
    assert.throws(() => verifyCase(entry, evidence, directory, context), /Cypress source build/);
});
test('case gate rejects missing, different or unpinned browser results', t => {
    const {directory, entry, evidence, context} = fixture(t);
    const file = path.join(directory, `${entry.runner}-results.json`);
    const results = JSON.parse(fs.readFileSync(file));
    for (const browser of [null, {name: 'electron', version: pins.CHROME_VERSION},
        {name: 'chrome-for-testing', version: '0.0.0.0'}]) {
        fs.writeFileSync(file, JSON.stringify({...results, browser}));
        assert.throws(() => verifyCase(entry, {...evidence, browser}, directory, context), /Chrome browser/);
    }
});

test('final gate consumes only artifacts from the current workflow attempt', t => {
    const {directory, entry, evidence} = fixture(t);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-attempt-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.copyFileSync(path.join(__dirname, '../dependencies.yaml'), path.join(root, 'dependencies.yaml'));
    fs.mkdirSync(path.join(root, 'tests'));
    fs.copyFileSync(path.join(__dirname, 'verify-scenarios.cjs'), path.join(root, 'tests/verify-scenarios.cjs'));
    const install = attempt => {
        const artifact = path.join(root, 'ci-artifacts', `case-${entry.id}-attempt-${attempt}`);
        fs.cpSync(directory, path.join(artifact, 'coverage'), {recursive: true});
        fs.writeFileSync(path.join(artifact, 'evidence.json'), JSON.stringify({...evidence, attempt}));
    };
    const run = () => {
        const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/gate.cjs')], {cwd: root, encoding: 'utf8', env: {...process.env,
            CI_SHA: 'candidate', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_STEP_SUMMARY: '',
            CI_NEEDS: JSON.stringify(Object.fromEntries(['static', 'integration', 'copyright', 'e2e', 'magento', 'images'].map(job => [job, {result: 'success'}])))}});
        assert.equal(result.status, 1, 'A single report must never qualify the full matrix');
        return JSON.parse(fs.readFileSync(path.join(root, 'ci-gate/qualification.json')));
    };
    install('1');
    assert.equal(run().completedCases, 0, 'An older artifact cannot satisfy a rerun');
    install('2');
    const report = run();
    assert.equal(report.completedCases, 1, 'The current attempt must be found and verified');
    assert.equal(report.attempt, '2');
    assert.equal(report.passed, false);
});

test('case gate rejects stale collection reports and missing coverage evidence', t => {
    const {directory, entry, evidence, context} = fixture(t);
    const summaryFile = path.join(directory, 'summary.json');
    const summary = JSON.parse(fs.readFileSync(summaryFile));
    fs.writeFileSync(summaryFile, JSON.stringify({...summary, run: 'warmup'}));
    assert.throws(() => verifyCase(entry, evidence, directory, context), /warmup/);
    fs.writeFileSync(summaryFile, JSON.stringify(summary));
    fs.rmSync(path.join(directory, 'cypress-results.json'));
    assert.throws(() => verifyCase(entry, evidence, directory, context), /ENOENT/);
});

for (const file of ['php/line-coverage.json', 'js/coverage-final.json', 'templates/coverage-summary.json', 'equivalence.json']) {
    test(`every host case requires ${file}`, t => {
        const {directory, entry, evidence, context} = fixture(t);
        fs.rmSync(path.join(directory, file));
        assert.throws(() => verifyCase(entry, evidence, directory, context), /ENOENT/);
    });
}

test('failed harness uploads sanitized failing test counts without completed report pointers', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-failed-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    fs.copyFileSync(path.join(__dirname, '../dependencies.yaml'), path.join(directory, 'dependencies.yaml'));
    const project = 'magelens-e2e-fixture';
    const coverage = path.join(directory, '.runtime/e2e', project, 'coverage');
    fs.mkdirSync(coverage, {recursive: true});
    fs.writeFileSync(path.join(directory, 'magelens-resource'), `${project} /tmp/magelens-e2e.fixture\n`);
    fs.writeFileSync(path.join(coverage, 'cypress-results.json'), JSON.stringify({
        run: 'failed-run', ...counts, totalPassed: 6, totalFailed: 1, message: 'SECRET',
        tests: [{title: titles[0], status: 'failed', error: 'SECRET', screenshot: '/private/SECRET'}]
    }));
    fs.writeFileSync(path.join(coverage, 'cypress-runner-results.json'), JSON.stringify({
        ...counts, totalTests: 11, totalPassed: 10, totalFailed: 1, error: 'SECRET',
        build: {...provenance('x64'), credentials: 'SECRET'}
    }));
    const entry = cases[0];
    const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/evidence.cjs')], {cwd: directory, encoding: 'utf8', env: {...process.env,
        CI_CASE: entry.id, CI_SHA: 'candidate', RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: '',
        CI_STEPS: JSON.stringify({e2e: {outcome: 'failure'}, cleanup: {outcome: 'success'}})}});
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'ci-reports', entry.id, 'evidence.json')));
    assert.equal(report.passed, false);
    assert.equal(report.counts.totalFailed, 1);
    assert.equal(report.counts.totalPassed, 6);
    assert.equal(report.runnerRegressionCounts.totalFailed, 1);
    assert.equal(report.runnerRegressionCounts.totalPassed, 10);
    const regressions = fs.readFileSync(path.join(directory, 'ci-reports', entry.id, 'cypress-runner-results.json'), 'utf8');
    assert.doesNotMatch(regressions, /SECRET|credentials/);
    const browser = fs.readFileSync(path.join(directory, 'ci-reports', entry.id, 'browser-results.json'), 'utf8');
    assert.doesNotMatch(browser, /SECRET|private|screenshot/);
    assert.match(browser, /failed/);
});

test('invalid full report fails its case while retaining safe acceptance and legacy coverage diagnostics', t => {
    const {directory, entry} = fixture(t);
    fs.copyFileSync(path.join(__dirname, '../dependencies.yaml'), path.join(directory, 'dependencies.yaml'));
    fs.writeFileSync(path.join(directory, 'magelens-result'), directory);
    fs.writeFileSync(path.join(directory, 'javascript-summary.json'), JSON.stringify({run: 'fresh', groups: {private: 'SECRET'}}));
    const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/evidence.cjs')], {cwd: directory, encoding: 'utf8', env: {...process.env,
        CI_CASE: entry.id, CI_SHA: 'candidate', RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: '',
        CI_STEPS: JSON.stringify({e2e: {outcome: 'success'}, cleanup: {outcome: 'success'}})}});
    assert.equal(result.status, 1, result.stderr);
    const target = path.join(directory, 'ci-reports', entry.id);
    const evidence = JSON.parse(fs.readFileSync(path.join(target, 'evidence.json')));
    assert.equal(evidence.passed, false);
    assert.deepEqual(evidence.counts, counts);
    assert.ok(evidence.diagnosticLocations.some(location => location.includes('report-equivalence.cjs:')));
    assert.ok(fs.existsSync(path.join(target, 'coverage/php/line-coverage.json')));
    assert.ok(!fs.existsSync(path.join(target, 'coverage/equivalence.json')));
    assert.doesNotMatch(JSON.stringify(evidence), /SECRET/);
});
