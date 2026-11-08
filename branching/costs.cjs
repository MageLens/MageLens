// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {planner} = require('./planner-client.cjs');
const plans = new WeakMap();
const solveCosts = input => JSON.parse(planner(['cost-plan'], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024
}));
function assertAutomatic(options = {}) {
    for (const key of ['mode', 'approach']) {
        if (options[key] !== undefined && options[key] !== 'AUTO') throw new Error('AUTO is the only branching policy. Use run-coverage without --branching for a linear run.');
    }
    for (const key of ['checkpointSelection', 'checkpointPolicy', 'solve']) {
        if (options[key] !== undefined) throw new Error('Manual checkpoint selection is not supported; AUTO selects checkpoints.');
    }
}
function costInput(workflow, specs) {
    return {baseline: workflow.costBaseline, maxCheckpointsPerTest: workflow.maxCheckpointsPerTest, parents: workflow.select(specs).map(s => s.parent), stages: [...workflow.stages.values()].map(s => ({
        id: s.id, parent: s.parent ?? null, checkpoint: s.checkpoint !== false, units: s.actionUnits ?? null
    }))};
}
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
function planWorkflow(workflow, specs) {
    const input = costInput(workflow, specs);
    const decision = freeze(structuredClone(module.exports.solveCosts(input)));
    if (!Array.isArray(decision.selected) || new Set(decision.selected).size !== decision.selected.length ||
        decision.selected.some(id => !workflow.stages.has(id) || workflow.stages.get(id).checkpoint === false)) throw new Error('Invalid AUTO checkpoint decision');
    const plan = Object.freeze({});
    plans.set(plan, {workflow, input: JSON.stringify(input), specs: workflow.select(specs).map(s => s.id), decision});
    return {plan, decision};
}
function resolvePlan(workflow, specs, plan) {
    if (plan === undefined) return planWorkflow(workflow, specs);
    const saved = plans.get(plan);
    if (!saved || saved.workflow !== workflow || saved.input !== JSON.stringify(costInput(workflow, saved.specs))) throw new Error('Invalid or stale AUTO plan');
    const selected = workflow.select(specs).map(s => s.id), wanted = new Set(selected);
    if (JSON.stringify(saved.specs.filter(id => wanted.has(id))) !== JSON.stringify(selected) ||
        saved.specs.some(id => !wanted.has(id) && workflow.chain(workflow.specs.get(id).parent).some(s => saved.decision.selected.includes(s.id)))) {
        throw new Error('AUTO plan consumers or execution order changed');
    }
    return {plan, decision: saved.decision};
}
module.exports = {costInput, solveCosts, planWorkflow, resolvePlan, assertAutomatic};
