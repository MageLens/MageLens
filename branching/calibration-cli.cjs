// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const fs = require('node:fs'), path = require('node:path');
const {openProject} = require('./baseline.cjs');
const {loadRunner} = require('./runners/index.cjs');
const {RetainedMagentoBackend} = require('./retained-magento.cjs');
const leases = require('./workflow-lease.cjs');

async function measureProject({manifest, project, storage, workflowLease, store}) {
    const workspace = process.cwd();
    require('./automatic.cjs').verifySources(manifest);
    require('./storage.cjs').probe(storage);
    const runner = loadRunner(process.env.MAGELENS_RUNNER ?? 'playwright');
    let runtime, report;
    const started = performance.now();
    try {
        runtime = await runner.open(process.env, project.runnerOptions);
        if (typeof runtime.calibrate !== 'function') throw new Error('This runner does not support checkpoint calibration');
        const backend = new RetainedMagentoBackend({workspace, helperImage:process.env.MAGELENS_BRANCHING_IMAGE,
            disposable:true, workflowLease});
        report = await runtime.calibrate({backend, root:storage, samples:3});
        require('./automatic.cjs').verifySources(manifest);
        if (report.status !== 'passed' || leases.needsRecovery(workflowLease))
            throw new Error('Checkpoint calibration failed; application recovery must complete before execution');
        report.baseline = {update:store.update(report, {explicit:true, replace:true})};
        if (!report.baseline.update.updated) throw new Error('Calibration produced no compatible checkpoint measurements');
        return report;
    } finally {
        await runtime?.close();
        if (report) {
            report.totalMs = performance.now() - started;
            const directory = path.join(workspace, '.runtime/branching-results');
            fs.mkdirSync(directory, {recursive:true});
            fs.writeFileSync(path.join(directory, `calibration-${report.run}.json`), JSON.stringify(report,null,2)+'\n', {mode:0o600});
        }
    }
}
async function run(args = process.argv.slice(2)) {
    if (args.length !== 3) throw new Error('Expected MANIFEST.json CONFIG.cjs COW_STORAGE');
    const [manifestFile, configuration, storage] = args;
    const manifest = require('./estimation.cjs').readManifest(manifestFile);
    const supplied = require(path.resolve(configuration));
    const project = typeof supplied === 'function' ? await supplied(manifest) : supplied;
    require('./costs.cjs').assertAutomatic(project);
    const workflowLease = leases.acquire(process.cwd());
    try {
        const store = openProject(process.cwd(), {...project.baseline, sourceDigest:manifest.sourceDigest});
        const report = await measureProject({manifest, project, storage, workflowLease, store});
        console.log(`${report.status}: checkpoint calibration (${report.costs.captures.length} captures, ${report.costs.restores.length} restores)`);
        return report;
    } finally {
        if (!leases.release(workflowLease)) { console.error('Calibration workflow lock retained for recovery'); process.exitCode = 1; }
    }
}
if (require.main === module) run().catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {run, measureProject};
