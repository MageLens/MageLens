// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {Graph} = require('./engine.cjs');
const {loadRunner} = require('./runners/index.cjs');
const {RetainedMagentoBackend} = require('./retained-magento.cjs');
const {probe} = require('./storage.cjs');

function activeCoverage(workspace) {
    const directory = path.join(workspace, 'coverage');
    const marker = path.join(directory, '.active-run');
    if (!fs.existsSync(marker)) return {};
    const coverageRunId = fs.readFileSync(marker, 'utf8').trim();
    const {id} = JSON.parse(fs.readFileSync(path.join(directory, 'run.json'), 'utf8'));
    if (!/^[a-f0-9]{32}$/.test(coverageRunId) || coverageRunId !== id)
        throw new Error('Active PHP coverage run does not match the prepared browser run');
    return {coverageRunId, javascriptCoverageDirectory:path.join(workspace, '.nyc_output'),
        templateCoverageDirectory:path.join(directory, 'raw', 'templates')};
}

async function main(configuration, storage) {
    const costs = require('./costs.cjs');
    costs.assertAutomatic(configuration);
    const workspace = process.cwd();
    const graph = configuration.workflow instanceof Graph ? configuration.workflow : new Graph(configuration.workflow);
    const specs = configuration.specs;
    graph.select(specs);
    if (typeof configuration.state !== 'function') throw new Error(messages.workflowModuleMustExportStateRuntime);
    const {plan} = costs.resolvePlan(graph, specs, configuration.plan);
    const runner = process.env.MAGELENS_RUNNER ?? 'playwright';
    const adapter = loadRunner(runner);
    const coverage = configuration.coverage ?? {};
    probe(storage);
    const runtime = await adapter.open(process.env, configuration.runnerOptions);
    const interrupt = () => { process.exitCode = 130; runtime.close().catch(() => {}); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
        const backend = new RetainedMagentoBackend({workspace, helperImage: process.env.MAGELENS_BRANCHING_IMAGE, disposable: true, workflowLease: configuration.workflowLease});
        const report = await runtime.run({workflow: graph, backend, state: configuration.state,
            root: storage, specs, plan, ...coverage,
            checkpointLifetime: configuration.checkpointLifetime ?? 'run',
            eventDirectory: process.env.MAGELENS_BRANCHING_EVENTS || path.join(workspace, '.runtime/branching-events')});
        report.browser = runtime.description;
        const output = path.join(workspace, '.runtime/branching-results'); fs.mkdirSync(output, {recursive: true});
        const file = path.join(output, report.run + '.json'); fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
        const uid = Number(process.env.MAGELENS_HOST_UID), gid = Number(process.env.MAGELENS_HOST_GID);
        if (Number.isInteger(uid) && Number.isInteger(gid)) { fs.chownSync(output, uid, gid); fs.chownSync(file, uid, gid); }
        console.log(`${report.status}: ${report.results.length} branches, ${report.counts.reuseHits} restores, ${report.counts.fallbacks} fallbacks`);
        console.log(`Report: ${file}`);
        if (report.observation.error) console.warn(report.observation.error);
        for (const warning of report.checkpointLimit.warnings) console.warn(warning.message);
        for (const error of report.errors) console.error(`${error.phase}: ${error.message}`);
        if (report.status !== 'passed') process.exitCode = 1;
        return report;
    } finally {
        process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
        await runtime.close();
    }
}
if (require.main === module) { console.error('Use run-coverage --branching with an automatic source manifest and native runner configuration.'); process.exitCode = 1; }
module.exports = {main, activeCoverage};
