// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {buildWorkflow} = require('./automatic.cjs');
const {main} = require('./cli.cjs');
const {fileDigest} = require('./engine.cjs');
const {orchestrate} = require('./costs.cjs');
async function run() {
    const [manifestPath, configPath, storage, approach, ...selected] = process.argv.slice(2);
    if (!['AUTO','P0','L0'].includes(approach)) throw new Error('Expected manifest, configuration, CoW storage and AUTO, P0 or L0');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const supplied = require(path.resolve(configPath));
    const project = typeof supplied === 'function' ? await supplied(manifest) : supplied;
    project.identity = {project: project.identity, configuration: fileDigest(configPath)};
    const configuration = buildWorkflow(manifest, project, selected.length ? selected : undefined);
    const result = await orchestrate({mode: approach, workflow: configuration.workflow,
        run: (mode, options = {}) => main([manifestPath, storage, mode], {...configuration, ...options})});
    if (result.decision) console.log(`Checkpoint policy: ${result.decision.reason}; ${result.decision.selected.length} selected (${result.decision.baseline.version}).`);
}
run().catch(error => {console.error(error.message); process.exitCode = 1;});
