// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {execute, Graph} = require('../branching/engine.cjs');
const {P0Provider} = require('../branching/provider.cjs');

async function runBranches({workflow, browser, backend, baseURL, root, state, specs, approach = 'P0', contextOptions, retain = false, checkpointLifetime = 'run', checkpointSelection, checkpointPolicy, eventDirectory, onEvent}) {
    // Validate before touching the application, even when invoked as a library.
    const graph = workflow instanceof Graph ? workflow : new Graph(workflow); graph.select(specs);
    const provider = new P0Provider({browser, backend, baseURL, state, contextOptions});
    return execute({workflow: graph, provider, approach, root, specs, retain, checkpointLifetime, checkpointSelection, checkpointPolicy, eventDirectory, onEvent});
}
module.exports = {runBranches, Graph, P0Provider};
