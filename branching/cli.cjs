// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {Graph} = require('./engine.cjs');
const {loadRunner} = require('./runners/index.cjs');
const {MagentoBackend} = require('./magento.cjs');
const {probe} = require('./storage.cjs');

async function main(args = process.argv.slice(2), suppliedConfiguration) {
    const [workflowPath, storage, approach = 'P0', ...specs] = args;
    if (!workflowPath || !storage || !['P0', 'L0'].includes(approach)) throw new Error('Expected workflow, storage directory and P0 or L0');
    const workspace = process.cwd();
    const configuration = suppliedConfiguration ?? require(path.resolve(workflowPath));
    const graph = configuration.workflow instanceof Graph ? configuration.workflow : new Graph(configuration.workflow); graph.select(specs.length ? specs : undefined);
    if (typeof configuration.state !== 'function') throw new Error('Workflow module must export state(runtime)');
    const adapter = loadRunner(process.env.MAGELENS_RUNNER ?? 'playwright');
    probe(storage);
    const runtime = await adapter.open();
    const interrupt = () => { process.exitCode = 130; runtime.close().catch(() => {}); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
        const backend = new MagentoBackend({workspace, helperImage: process.env.MAGELENS_P0_IMAGE, disposable: true});
        const report = await runtime.run({workflow: graph, backend, state: configuration.state,
            root: storage, approach, specs: specs.length ? specs : undefined,
            checkpointLifetime: configuration.checkpointLifetime ?? 'run',
            checkpointSelection: configuration.checkpointSelection, checkpointPolicy: configuration.checkpointPolicy,
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
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {main};
