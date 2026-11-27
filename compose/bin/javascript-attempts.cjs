// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Sparse JavaScript hit counters of one test attempt (docs/coverage.md#test-attempts). Shared by the
// Cypress support file in the browser and by the Node side, so it has no Node imports.

// Keeps only the counters that were hit: {file: {s: {id: hits}, f: {id: hits}, b: {id: [hits]}}}.
function sparseCounters(coverage) {
    const counters = {};
    for (const [file, {s = {}, f = {}, b = {}}] of Object.entries(coverage)) {
        const hit = {};
        for (const [type, values] of [['s', s], ['f', f]]) {
            const entries = Object.entries(values).filter(([, hits]) => hits > 0);
            if (entries.length) hit[type] = Object.fromEntries(entries);
        }
        const branches = Object.entries(b).filter(([, hits]) => hits.some(count => count > 0));
        if (branches.length) hit.b = Object.fromEntries(branches);
        if (Object.keys(hit).length) counters[file] = hit;
    }
    return counters;
}

// Adds the counters of another page of the same attempt.
function mergeCounters(target, source) {
    for (const [file, hit] of Object.entries(source)) {
        const merged = target[file] ||= {};
        for (const type of ['s', 'f']) {
            for (const [id, hits] of Object.entries(hit[type] || {})) (merged[type] ||= {})[id] = (merged[type][id] || 0) + hits;
        }
        for (const [id, hits] of Object.entries(hit.b || {})) {
            const branch = (merged.b ||= {})[id] ||= hits.map(() => 0);
            if (branch.length !== hits.length) throw new Error(`Branch ${id} of ${file} changed its paths`);
            hits.forEach((count, index) => { branch[index] += count; });
        }
    }
    return target;
}

module.exports = {sparseCounters, mergeCounters};
