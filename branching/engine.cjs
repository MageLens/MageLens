// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {Graph} = require('./graph.cjs');
const {CheckpointStore} = require('./checkpoint-store.cjs');
const {cleanup, inventory} = require('./checkpoint-files.cjs');
const {canonical, digest, fileDigest} = require('./identity.cjs');
const costs = require('./costs.cjs');
const {executePlan} = require('./execution-run.cjs');
async function execute(options) {
    costs.assertAutomatic(options);
    const workflow = options.workflow instanceof Graph ? options.workflow : new Graph(options.workflow);
    const {decision} = costs.resolvePlan(workflow, options.specs, options.plan);
    return executePlan({...options, workflow,
        approach: decision.selected.length ? 'branching' : 'L0',
        checkpointSelection: decision.selected, checkpointPolicy: decision});
}
module.exports = {Graph, CheckpointStore, execute, cleanup, digest, canonical, fileDigest, inventory};
