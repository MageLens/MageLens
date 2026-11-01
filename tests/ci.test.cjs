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
    write('installation.json', {...entry, version: pins.MAGENTO_VERSION, credential: 'SECRET'});
    write(`${entry.runner}-results.json`, {run: 'fresh', ...counts, tests: titles.map(title => ({title, status: 'passed', error: 'SECRET'}))});
    write('summary.json', {run: 'fresh', metrics: Object.fromEntries(['php', 'js', 'templates'].map(type => [type, {percent: 50}]))});
    write('project-fixtures.json', {Application_Blog: {themePaths: ['Magento/luma'], password: 'SECRET'}});
    write('php/line-coverage.json', {'/shop/app/code/Application/Blog/Model/Article.php': {'1': 1}, '/shop/vendor/private/SECRET.php': {'1': 0}});
    write('js/coverage-final.json', {'/shop/app/code/Application/Blog/view/adminhtml/web/js/admin.js': {s: {'0': 1}, statementMap: {'0': {start: {line: 1}}}, code: 'SECRET'}, '/vendor/private/SECRET.js': {}});
    write('templates/coverage-summary.json', {templates: [{path: 'app/code/Application/Blog/view/frontend/templates/blog.phtml', source: 'SECRET', statements: [{start: {line: 1}, syntax: 'html', hits: 1, source: 'SECRET'}]}, {path: 'vendor/private/SECRET.phtml', source: 'SECRET'}]});
    const evidence = {...entry, sha: 'candidate', workflowRun: '123', attempt: '1', host: 'Linux', image: 'ubuntu', imageVersion: 'today', architecture: 'x64', passed: true,
        feasibility: {passed: true, sha: 'candidate'}, steps: Object.fromEntries(['probe', 'isolation', 'e2e', 'cleanup'].map(step => [step, {outcome: 'success'}])), dependencies: pins, counts};
    return {directory, entry, evidence, context: {sha: 'candidate', run: '123', attempt: '1'}};
}
test('matrix is eight Linux modes and the two requested actual host cases', () => {
    assert.equal(cases.length, 10);
    assert.equal(new Set(cases.map(c => c.id)).size, 10);
    assert.equal(cases.filter(c => c.os === 'ubuntu-latest').length, 8);
    assert.deepEqual(cases.filter(c => c.os !== 'ubuntu-latest').map(({os, platform, theme, runner}) => ({os, platform, theme, runner})), [
        {os: 'macos-latest', platform: 'mageos', theme: 'hyva', runner: 'playwright'},
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
        {counts: {...counts, totalSkipped: 1}}, {feasibility: {passed: false}}, {steps: {...evidence.steps, cleanup: {outcome: 'cancelled'}}}]) {
        assert.throws(() => verifyCase(entry, {...evidence, ...patch}, directory, context));
    }
});
test('final gate fails when reports are missing even if all job results claim success', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-ci-gate-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const result = spawnSync(process.execPath, [path.join(__dirname, 'ci/gate.cjs'), 'absent'], {cwd: directory, encoding: 'utf8', env: {...process.env,
        CI_SHA: 'candidate', CI_NEEDS: JSON.stringify(Object.fromEntries(['static', 'integration', 'copyright', 'e2e', 'magento'].map(job => [job, {result: 'success'}])))}});
    assert.equal(result.status, 1);
    const report = JSON.parse(fs.readFileSync(`${directory}/ci-gate/qualification.json`));
    assert.equal(report.passed, false);
    assert.equal(report.completedCases, 0);
    assert.equal(report.expectedCases, 10);
    assert.match(result.stdout, /Linux comparison incomplete/);
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
