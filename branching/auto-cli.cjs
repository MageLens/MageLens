// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {main} = require('./cli.cjs');
const {fileDigest} = require('./engine.cjs');
const {assertAutomatic} = require('./costs.cjs');
const {runSuite} = require('./suite.cjs');
const {loadRunner} = require('./runners/index.cjs');
async function run(args = process.argv.slice(2)) {
    const [manifestPath, configPath, storage, approach = 'AUTO', ...extra] = args;
    if (!manifestPath || !configPath || !storage || extra.length) throw new Error(messages.automaticUsage);
    assertAutomatic({approach});
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const supplied = require(path.resolve(configPath));
    const project = typeof supplied === 'function' ? await supplied(manifest) : supplied;
    assertAutomatic(project);
    if (!project.native?.config) throw new Error('AUTO requires a native runner configuration for complete test discovery and linear fallback.');
    project.identity = {project: project.identity, configuration: fileDigest(configPath)};
    const directory = path.resolve('.runtime/branching-results/native-' + require('node:crypto').randomUUID());
    const leases = require('./workflow-lease.cjs');
    const workflowLease = leases.acquire(process.cwd());
    let report;
    try { report = await runSuite({manifest, project, mode: approach, directory,
        runner: loadRunner(process.env.MAGELENS_RUNNER ?? 'playwright').native,
        runCheckpoint: configuration => main({...configuration, workflowLease}, storage)}); }
    finally { if (!leases.release(workflowLease)) { console.error('Suite workflow lock retained for application recovery'); process.exitCode = 1; } }
    const output = path.join(directory, 'suite.json'); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
    const uid = Number(process.env.MAGELENS_HOST_UID), gid = Number(process.env.MAGELENS_HOST_GID);
    if (Number.isInteger(uid) && Number.isInteger(gid)) { fs.chownSync(path.dirname(directory), uid, gid); fs.chownSync(directory, uid, gid); fs.chownSync(output, uid, gid); }
    console.log(`${report.status}: ${report.results.length}/${report.inventory.length} tests, ${report.checkpoints} checkpoints, ${report.skipped.length} native skips`);
    console.log(`Report: ${output}`);
    if (report.status !== 'passed') process.exitCode = 1;
    return report;
}
if (require.main === module) run().catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {run};
