// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {cases} = require('./cases.cjs');
const {validateSnapshot, compareThemes} = require('./report-equivalence.cjs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function verifyCase(entry, evidence, directory, context) {
    for (const key of ['id', 'os', 'platform', 'theme', 'runner']) assert.equal(evidence[key], entry[key], key);
    assert.equal(evidence.sha, context.sha, 'Wrong commit');
    assert.equal(evidence.workflowRun, context.run, 'Wrong workflow run');
    assert.equal(evidence.attempt, context.attempt, 'Stale artifact from an earlier attempt');
    assert.equal(evidence.host, {'ubuntu-latest': 'Linux', 'macos-26-intel': 'macOS', 'windows-latest': 'Windows'}[entry.os]);
    assert.ok(evidence.image && evidence.imageVersion && evidence.architecture, 'Missing runner provenance');
    assert.equal(evidence.passed, true, 'Incomplete harness');
    assert.equal(evidence.feasibility?.passed, true, 'Host feasibility not proven');
    assert.equal(evidence.feasibility.sha, context.sha);
    for (const step of ['probe', 'resources', 'isolation', 'e2e', 'cleanup']) assert.equal(evidence.steps[step]?.outcome, 'success', step);
    assert.deepEqual(evidence.counts, {totalTests: 7, totalPassed: 7, totalFailed: 0, totalSkipped: 0, totalPending: 0});
    const run = read(path.join(directory, 'run.json'));
    const results = read(path.join(directory, `${entry.runner}-results.json`));
    const summary = read(path.join(directory, 'summary.json'));
    const installation = read(path.join(directory, 'installation.json'));
    assert.ok(run.id);
    assert.equal(run.runner, entry.runner);
    assert.equal(results.run, run.id);
    assert.equal(summary.run, run.id);
    for (const key of ['platform', 'theme', 'runner']) assert.equal(installation[key], entry[key]);
    const pins = Object.fromEntries([...fs.readFileSync('dependencies.yaml', 'utf8').matchAll(/^(\w+): "([^"]+)"$/gm)].map(m => [m[1], m[2]]));
    assert.deepEqual(evidence.dependencies, pins, 'Dependency provenance differs');
    assert.equal(installation.version, pins[entry.platform === 'mageos' ? 'MAGEOS_VERSION' : 'MAGENTO_VERSION']);
    for (const type of ['php', 'js', 'templates']) {
        const percent = summary.metrics[type]?.percent;
        assert.ok(Number.isFinite(percent) && percent >= 0 && percent <= 100, `Invalid ${type} summary`);
    }
    assert.ok(Object.keys(read(path.join(directory, 'php/line-coverage.json'))).length, 'Missing PHP coverage');
    assert.ok(Object.keys(read(path.join(directory, 'js/coverage-final.json'))).length, 'Missing JavaScript coverage');
    assert.ok(read(path.join(directory, 'templates/coverage-summary.json')).templates.length, 'Missing template coverage');
    validateSnapshot(read(path.join(directory, 'equivalence.json')), run.id, summary);
    execFileSync(process.execPath, ['tests/verify-scenarios.cjs', directory], {stdio: 'inherit'});
    return run.id;
}
function gate() {
    const root = process.argv[2] || 'ci-artifacts';
    const needs = JSON.parse(process.env.CI_NEEDS);
    const errors = [];
    for (const name of ['static', 'integration', 'copyright', 'e2e', 'magento']) {
        if (needs[name]?.result !== 'success') errors.push(`${name}: ${needs[name]?.result || 'missing'}`);
    }
    const reports = [], themeReports = [], runIds = new Set();
    for (const entry of cases) {
        try {
            const artifact = `case-${entry.id}-attempt-${process.env.GITHUB_RUN_ATTEMPT}`;
            const directory = path.join(root, artifact, 'coverage');
            const id = verifyCase(entry, read(path.join(root, artifact, 'evidence.json')), directory,
                {sha: process.env.CI_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT});
            assert.ok(!runIds.has(id), 'Duplicate collection run ID');
            runIds.add(id);
            themeReports.push({...entry, snapshot: read(path.join(directory, 'equivalence.json'))});
            if (entry.os === 'ubuntu-latest') reports.push(directory);
        } catch (error) { errors.push(`${entry.id}: ${error.message}`); }
    }
    if (reports.length === 8) {
        try {
            execFileSync(process.execPath, ['tests/compare-matrix.cjs', ...reports], {stdio: 'inherit',
                env: {...process.env, MAGELENS_MATRIX_REPORT: 'ci-gate/linux-matrix-comparison.json'}});
        } catch { errors.push('Eight-way Linux coverage comparison failed'); }
    } else errors.push(`Linux comparison incomplete: ${reports.length}/8 reports`);
    fs.mkdirSync('ci-gate', {recursive: true});
    const themes = compareThemes(themeReports, cases);
    fs.writeFileSync('ci-gate/theme-report-comparison.json', JSON.stringify(themes, null, 2) + '\n');
    errors.push(...themes.errors);
    const report = {sha: process.env.CI_SHA, workflowRun: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
        expectedCases: cases.length, completedCases: runIds.size, expectedAcceptanceTests: 70, themeReportsEqual: themes.passed, passed: errors.length === 0, errors};
    fs.writeFileSync('ci-gate/qualification.json', JSON.stringify(report, null, 2) + '\n');
    const summary = `${report.passed ? 'PASS' : 'INCOMPLETE'}: ${runIds.size}/10 complete cases; 70 acceptance tests required.\n${errors.join('\n')}`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Required CI gate\n\n${summary}\n`);
    process.exitCode = report.passed ? 0 : 1;
}
module.exports = {verifyCase};
if (require.main === module) gate();
