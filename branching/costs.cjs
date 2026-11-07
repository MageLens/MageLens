// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {planner} = require('./planner-client.cjs');
const solveCosts = input => JSON.parse(planner(['cost-plan'], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024
}));
function costInput(workflow) {
    return {parents: workflow.select().map(s=>s.parent), stages: [...workflow.stages.values()].map(s=>({
        id: s.id, parent: s.parent ?? null, checkpoint: s.checkpoint !== false, units: s.actionUnits ?? null
    }))};
}
async function orchestrate({mode,workflow,run,solve=solveCosts}) {
    if (!['AUTO','P0','L0'].includes(mode)) throw new Error('Unknown cost execution mode');
    if (mode !== 'AUTO') return {report: await run(mode)};
    // Pure source-derived estimates and compiled Rust constants: no calibration,
    // profile/cache lookup, hardware query, database query or warm-up run.
    const decision = solve(costInput(workflow));
    return {decision, report: await run(decision.selected.length ? 'P0' : 'L0', {
        checkpointSelection: decision.selected, checkpointPolicy: decision
    })};
}
module.exports = {costInput, solveCosts, orchestrate};
