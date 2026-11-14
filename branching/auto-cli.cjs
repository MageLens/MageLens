// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {main, activeCoverage} = require('./cli.cjs');
const {fileDigest} = require('./engine.cjs');
const {assertAutomatic} = require('./costs.cjs');
const {runSuite, playwrightCoverageResult} = require('./suite.cjs');
const {loadRunner} = require('./runners/index.cjs');
function coverageCommand(command) {
    execFileSync('bash', ['-c', 'source bin/common; source bin/coverage-lifecycle; "$@"',
        'coverage', ...command], {stdio: 'inherit'});
}
async function run(args = process.argv.slice(2)) {
    try { return await execute(args); }
    catch (error) { require('./estimation.cjs').recordFailure(args[0], error); throw error; }
}
async function execute(args) {
    const started = performance.now();
    const [manifestPath, configPath, storage, approach = 'AUTO', ...extra] = args;
    if (!manifestPath || !configPath || !storage || extra.length) throw new Error(messages.automaticUsage);
    assertAutomatic({approach});
    const manifest = require('./estimation.cjs').readManifest(manifestPath);
    require('./automatic.cjs').verifySources(manifest);
    require('./estimation.cjs').assertExecutable(manifest);
    const supplied = require(path.resolve(configPath));
    const project = typeof supplied === 'function' ? await supplied(manifest) : supplied;
    assertAutomatic(project);
    if (!project.native?.config) throw new Error('AUTO requires a native runner configuration for complete test discovery and linear fallback.');
    project.identity = {project: project.identity, configuration: fileDigest(configPath)};
    const directory = path.resolve('.runtime/branching-results/native-' + require('node:crypto').randomUUID());
    const leases = require('./workflow-lease.cjs');
    const workflowLease = leases.acquire(process.cwd());
    const runnerName = process.env.MAGELENS_RUNNER ?? 'playwright';
    const collectCoverage = runnerName === 'playwright' && project.native.coverage === true;
    const driverTiming = {validationMs: performance.now() - started};
    let phaseStart = performance.now();
    let report;
    try {
        if (collectCoverage && !project.adapter) {
            const adapter = require('./automatic.cjs').playwrightCoverageAdapter(manifest);
            if (manifest.tests.some(adapter.supports)) project.adapter = adapter;
        }
        const store = require('./baseline.cjs').openProject(process.cwd(), project.baseline);
        const used = store.load(); project.costBaseline = used.baseline;
        if (collectCoverage) {
            coverageCommand(['coverage_cleanup']);
            coverageCommand(['coverage_prepare', 'playwright', 'bin/run-playwright.cjs']);
        }
        const coverage = collectCoverage ? activeCoverage(process.cwd()) : {};
        const {coverageRunId} = coverage;
        if (collectCoverage && !coverageRunId) throw new Error('Playwright coverage preparation did not activate a run');
        driverTiming.preparationMs = performance.now() - phaseStart;
        phaseStart = performance.now();
        report = await runSuite({manifest, project, mode: approach, directory,
        ...(collectCoverage ? {coverageRoot: process.cwd()} : {}),
        runner: loadRunner(runnerName).native,
        runCheckpoint: configuration => main({...configuration, workflowLease, coverage}, storage)});
        driverTiming.suiteMs = performance.now() - phaseStart;
        phaseStart = performance.now();
        const missingMeasurements = require('./configs/baseline.json').metrics.filter(metric => !used.samples[metric]);
        report.baseline = {used, missingMeasurements, update: store.update(report)};
        if (coverageRunId && report.status === 'passed') {
            if (leases.needsRecovery(workflowLease)) throw new Error('Playwright coverage requires completed application recovery');
            if (activeCoverage(process.cwd()).coverageRunId !== coverageRunId)
                throw new Error('Playwright coverage run changed during suite execution');
            const result = playwrightCoverageResult(report, coverageRunId, process.env.CHROME_VERSION);
            fs.writeFileSync('coverage/playwright-results.json', JSON.stringify(result, null, 2) + '\n');
            coverageCommand(['coverage_finalize']);
        }
        for (const regression of report.baseline.update.regressions ?? [])
            console.warn(`Checkpoint overhead increased: ${regression.metric} ${regression.referenceMs.toFixed(1)} → ${regression.observedMs.toFixed(1)} ms`);
        driverTiming.reportingMs = performance.now() - phaseStart;
    }
    finally {
        const cleanupStarted = performance.now();
        try {
            if (collectCoverage && !leases.needsRecovery(workflowLease)) coverageCommand(['coverage_cleanup']);
        } finally {
            if (!leases.release(workflowLease)) { console.error('Suite workflow lock retained for application recovery'); process.exitCode = 1; }
            driverTiming.cleanupMs = performance.now() - cleanupStarted;
        }
    }
    report.driverTiming = {...driverTiming, totalMs: performance.now() - started};
    const output = path.join(directory, 'suite.json'); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
    const uid = Number(process.env.MAGELENS_HOST_UID), gid = Number(process.env.MAGELENS_HOST_GID);
    if (Number.isInteger(uid) && Number.isInteger(gid)) { fs.chownSync(path.dirname(directory), uid, gid); fs.chownSync(directory, uid, gid); fs.chownSync(output, uid, gid); }
    console.log(`${report.status}: ${report.results.length}/${report.inventory.length} tests, ${report.checkpoints} checkpoints, ${report.skipped.length} native skips`);
    console.log(`Report: ${output}`);
    if (report.status !== 'passed') process.exitCode = 1;
    return report;
}
if (require.main === module) run().catch(error => {console.error(require('./estimation.cjs').formatError(error)); process.exitCode = 1;});
module.exports = {run, coverageCommand};
