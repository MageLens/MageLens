// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {APPROACH} = require('../branching/configs/runtime.cjs');
const {execute, Graph} = require('../branching/engine.cjs');
const {BranchingProvider} = require('../branching/provider.cjs');
const {RetainedProvider} = require('../branching/retained-provider.cjs');

async function runBranches(options) {
    require('../branching/costs.cjs').assertAutomatic(options);
    const {workflow, browser, backend, baseURL, root, state, specs, approach = APPROACH.automatic, contextOptions, retain = false, checkpointLifetime = 'run', eventDirectory, onEvent, plan} = options;
    // Validate before touching the application, even when invoked as a library.
    const graph = workflow instanceof Graph ? workflow : new Graph(workflow); graph.select(specs);
    const Provider = backend.retainsServices ? RetainedProvider : BranchingProvider;
    const provider = new Provider({browser, backend, baseURL, state, contextOptions});
    return execute({workflow: graph, provider, approach, root, specs, retain, checkpointLifetime, eventDirectory, onEvent, plan});
}
module.exports = {runBranches, Graph, BranchingProvider};
