// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {cases} = require('./cases.cjs');
const {snapshot} = require('./report-equivalence.cjs');
const {execFileSync} = require('node:child_process');
const pick = (value, keys) => Object.fromEntries(keys.filter(key => key in value).map(key => [key, value[key]]));
const blog = file => file.includes('/Application/Blog/');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const countKeys = ['totalTests', 'totalPassed', 'totalFailed', 'totalSkipped', 'totalPending'];
const buildKeys = ['version', 'commit', 'buildNode', 'distribution', 'repository', 'architecture', 'patchSha256'];
const testResults = results => ({...pick(results, ['run', ...countKeys]),
    browser: results.browser ? pick(results.browser, ['name', 'version']) : null,
    tests: (results.tests || []).map(test => pick(test, ['title', 'status']))});
const runnerResults = results => ({...pick(results, ['browserName', 'browserVersion', 'cypressVersion', ...countKeys]),
    build: pick(results.build || {}, buildKeys)});
function sanitizedCoverage(source) {
    const run = read(path.join(source, 'run.json'));
    const runner = run.runner || 'cypress';
    const results = read(path.join(source, `${runner}-results.json`));
    const templates = read(path.join(source, 'templates/coverage-summary.json'));
    // Project fixture credentials, vendor source, inline code and request URLs never leave the runner.
    const installation = read(path.join(source, 'installation.json'));
    const projected = {
        'run.json': pick(run, ['id', 'runner']),
        'installation.json': {...pick(installation, ['platform', 'version', 'phpVersion', 'nodeVersion', 'theme', 'runner']),
            ...(installation.runnerBuild ? {runnerBuild: pick(installation.runnerBuild, buildKeys)} : {})},
        'project-fixtures.json': {Application_Blog: {themePaths: read(path.join(source, 'project-fixtures.json')).Application_Blog.themePaths}},
        [`${runner}-results.json`]: testResults(results),
        'summary.json': pick(read(path.join(source, 'summary.json')), ['run', 'generatedAt', 'metrics']),
        'php/line-coverage.json': Object.fromEntries(Object.entries(read(path.join(source, 'php/line-coverage.json'))).filter(([file]) => blog(file))),
        'js/coverage-final.json': Object.fromEntries(Object.entries(read(path.join(source, 'js/coverage-final.json'))).filter(([file]) => blog(file)).map(([file, data]) =>
            [file, pick(data, ['s', 'statementMap'])])),
        'templates/coverage-summary.json': {templates: templates.templates.filter(entry => blog(entry.path)).map(entry => ({
            path: entry.path, statements: entry.statements.map(statement => pick(statement, ['start', 'syntax', 'hits']))
        }))}
    };
    const predictionFile = path.join(source, 'prediction.json');
    if (fs.existsSync(predictionFile)) {
        const prediction = read(predictionFile);
        for (const sample of prediction.samples ?? [prediction.sample]) {
            delete sample.sourceArchive;
            if (sample.predictionError) sample.predictionError = {code:'ESTIMATION_FAILED',statusCode:500};
        }
        projected['prediction.json'] = prediction;
    }
    if (runner === 'cypress') {
        projected['cypress-runner-results.json'] = runnerResults(read(path.join(source, 'cypress-runner-results.json')));
    }
    return projected;
}
function writeEvidence() {
    const entry = cases.find(entry => entry.id === process.env.CI_CASE);
    if (!entry) throw new Error('Unknown matrix case');
    const directory = `ci-reports/${entry.id}`;
    fs.mkdirSync(directory, {recursive: true});
    const report = {...entry, sha: process.env.CI_SHA, workflowRun: process.env.GITHUB_RUN_ID,
        attempt: process.env.GITHUB_RUN_ATTEMPT, host: process.env.RUNNER_OS, architecture: process.arch,
        runtime: process.env.CI_HOST_RUNTIME || 'native', image: process.env.ImageOS, imageVersion: process.env.ImageVersion, memoryGiB: Math.round(os.totalmem() / 2 ** 30),
        dependencies: Object.fromEntries([...fs.readFileSync('dependencies.yaml', 'utf8').matchAll(/^(\w+): "([^"]+)"$/gm)].map(match => [match[1], match[2]])),
        counts: null, steps: Object.fromEntries(Object.entries(JSON.parse(process.env.CI_STEPS)).map(([key, value]) => [key, pick(value, ['outcome', 'conclusion'])])), passed: false};
    // Failed harnesses still retain their browser results under the owned project.
    const registry = path.join(process.env.RUNNER_TEMP, 'magelens-resource');
    try {
        if (fs.existsSync(registry)) {
            const project = fs.readFileSync(registry, 'utf8').trim().split(' ')[0];
            if (!/^magelens-e2e-[a-z0-9]+$/.test(project)) throw new Error('Invalid project evidence path');
            const results = `.runtime/e2e/${project}/coverage/${entry.runner}-results.json`;
            if (fs.existsSync(results)) {
                const safe = testResults(read(results));
                report.counts = pick(safe, countKeys);
                report.browser = safe.browser;
                fs.writeFileSync(`${directory}/browser-results.json`, JSON.stringify(safe, null, 2) + '\n');
            }
            const regressions = `.runtime/e2e/${project}/coverage/cypress-runner-results.json`;
            if (entry.runner === 'cypress' && fs.existsSync(regressions)) {
                const safe = runnerResults(read(regressions));
                report.runnerRegressionCounts = pick(safe, countKeys);
                fs.writeFileSync(`${directory}/cypress-runner-results.json`, JSON.stringify(safe, null, 2) + '\n');
            }
        }
    } catch { report.diagnostics = 'Browser results were incomplete or unreadable.'; }
    try {
        if (fs.existsSync('ci-reports/feasibility.json')) report.feasibility = read('ci-reports/feasibility.json');
        const source = fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'magelens-result'), 'utf8').trim();
        // The result path is created only after every harness acceptance check has passed.
        for (const [file, value] of Object.entries(sanitizedCoverage(source))) {
            const target = path.join(directory, 'coverage', file);
            fs.mkdirSync(path.dirname(target), {recursive: true});
            fs.writeFileSync(target, JSON.stringify(value) + '\n');
        }
        report.counts = pick(read(`${directory}/coverage/${entry.runner}-results.json`), ['totalTests', 'totalPassed', 'totalFailed', 'totalSkipped', 'totalPending']);
        report.browser = read(`${directory}/coverage/${entry.runner}-results.json`).browser;
        fs.writeFileSync(`${directory}/coverage/equivalence.json`, JSON.stringify(snapshot(source)) + '\n');
        execFileSync(process.execPath, ['tests/verify-scenarios.cjs', `${directory}/coverage`], {stdio: 'inherit'});
        report.passed = !report.diagnostics && ['probe', 'resources', 'isolation', 'e2e', 'cleanup'].every(step => report.steps[step]?.outcome === 'success');
    } catch (error) {
        // Errors can contain arbitrary subprocess output; publish a fixed diagnostic.
        report.incomplete = 'Missing or invalid completed harness report. Inspect the failed step in Actions.';
        // Public script locations identify projection failures without exposing values.
        report.diagnosticLocations = [...new Set((error.stack || '').match(/tests[\\/]ci[\\/](?:report-equivalence|evidence)\.cjs:\d+:\d+/g) || [])];
    }
    // Diagnostics are structured outcomes and resource facts, never raw service/install logs.
    fs.writeFileSync(`${directory}/evidence.json`, JSON.stringify(report, null, 2) + '\n');
    const size = fs.readdirSync(directory, {recursive: true, withFileTypes: true}).filter(file => file.isFile())
        .reduce((total, file) => total + fs.statSync(path.join(file.parentPath, file.name)).size, 0);
    if (size > 5 * 1024 * 1024) {
        fs.rmSync(`${directory}/coverage`, {recursive: true, force: true});
        report.passed = false;
        report.incomplete = 'Sanitized artifact exceeds 5 MiB limit; coverage upload withheld.';
        fs.writeFileSync(`${directory}/evidence.json`, JSON.stringify(report, null, 2) + '\n');
        throw new Error(report.incomplete);
    }
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `## ${entry.id}\n\n${report.passed ? 'PASS: 7/7 acceptance scenarios and all harness checks.' : 'INCOMPLETE: full matrix cannot pass.'}\n\nCommit: \`${report.sha}\`\n`);
    const predictionFile = `${directory}/coverage/prediction.json`;
    if (process.env.GITHUB_STEP_SUMMARY) {
        const quality = fs.existsSync(predictionFile) ? read(predictionFile).quality : null;
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Predictor: ${quality?.status ?? 'missing'}; raw error ${quality?.raw?.medianAbsolutePercentError ?? 'unavailable'}%; baseline-adjusted error ${quality?.medianAbsolutePercentError ?? 'unavailable'}%.\n`);
    }
    if (report.steps.e2e?.outcome === 'success' && !report.passed) process.exitCode = 1;
}
module.exports = {sanitizedCoverage, testResults};
if (require.main === module) writeEvidence();
