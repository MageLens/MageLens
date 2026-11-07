// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const config = require('./configs/runtime.cjs');

const {maxCheckpointsPerTest} = require('./planner/src/limits.json');

// AUTO selects using Rust's complete cost model. Keep a defensive limit in the
// execution mechanism, also exercised independently by provider recovery tests.
function limitCheckpoints(graph, specs, {requested, approach, checkpointLifetime}) {
    const paths = specs.map(spec => graph.chain(spec.parent));
    const consumers = new Map();
    for (const path of paths) for (const node of path) consumers.set(node.id, (consumers.get(node.id) ?? 0) + 1);
    const warnings = paths.flatMap((path, i) => {
        const count = path.filter(node => node.checkpoint !== false && consumers.get(node.id) > 1).length;
        return count > maxCheckpointsPerTest ? [{code: 'checkpoint-limit', test: specs[i].id, candidates: count,
            limit: maxCheckpointsPerTest, message: `${specs[i].label ?? specs[i].id}: ${count} reusable checkpoint candidates; at most ${maxCheckpointsPerTest} can be selected. Consider splitting this long shared journey.`}] : [];
    });
    const candidates = new Set(paths.flat().filter(node => approach === config.APPROACH.branching && node.checkpoint !== false &&
        (!requested || requested.has(node.id)) && (checkpointLifetime === config.checkpoint.lifetime || consumers.get(node.id) > 1)).map(node => node.id));
    const withinLimit = set => paths.every(path => path.filter(node => set.has(node.id)).length <= maxCheckpointsPerTest);
    let chosen = candidates;
    if (!withinLimit(chosen)) {
        // Prefer marginal repeated work saved, not raw depth. Unknown manual
        // stages use one structural unit; AUTO never treats unknowns as free.
        const work = set => {
            const available = new Set(); let total = 0;
            for (const path of paths) {
                const last = path.findLastIndex(node => available.has(node.id));
                for (const node of path.slice(last + 1)) {
                    total += Number.isSafeInteger(node.actionUnits) && node.actionUnits >= 0 ? node.actionUnits : 1;
                    if (set.has(node.id)) available.add(node.id);
                }
            }
            return total;
        };
        chosen = new Set();
        while (true) {
            let best, bestCost = Infinity;
            for (const id of [...candidates].sort()) {
                if (chosen.has(id)) continue;
                const next = new Set([...chosen, id]);
                if (!withinLimit(next)) continue;
                const cost = work(next);
                if (cost < bestCost) { best = id; bestCost = cost; }
            }
            if (!best) break;
            chosen.add(best);
        }
    }
    return {chosen, report: {maxCheckpointsPerTest, warnings, selected: [...chosen],
        skipped: [...candidates].filter(id => !chosen.has(id)), basis: 'per-test-path-limit'}};
}
module.exports = {limitCheckpoints, maxCheckpointsPerTest};
