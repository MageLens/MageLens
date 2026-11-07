// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const config = require('./configs/runtime.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {buildWorkflow} = require('./automatic.cjs');
const {main} = require('./cli.cjs');
const {fileDigest} = require('./engine.cjs');
const {orchestrate} = require('./costs.cjs');
async function run() {
    const [manifestPath, configPath, storage, approach, ...selected] = process.argv.slice(2);
    if (!config.costModes.includes(approach)) throw new Error(messages.automaticUsage);
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
