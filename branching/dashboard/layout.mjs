// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

export function layout(nodes, schedule) {
    const children = new Map(nodes.map((node) => [node.id, []]));
    const points = new Map();
    const roots = [];
    for (const node of nodes) (children.get(node.parent) ?? roots).push(node);
    const order = new Map(schedule.map((id, index) => [id, index]));
    const earliest = new Map();
    const firstTest = (node) => {
        if (!earliest.has(node.id))
            earliest.set(node.id, order.get(node.id) ?? Math.min(...children.get(node.id).map(firstTest)));
        return earliest.get(node.id);
    };
    const byExecution = (a, b) => firstTest(a) - firstTest(b);
    roots.sort(byExecution);
    for (const branch of children.values()) branch.sort(byExecution);
    let column = 0;
    let maxDepth = 0;
    let offsetY = 0;
    let width = 278;

    function place(node, depth) {
        maxDepth = Math.max(maxDepth, depth);
        const branch = children.get(node.id);
        const xs = branch.map((child) => place(child, depth + 1));
        const x = xs.length ? (xs[0] + xs.at(-1)) / 2 : 28 + column++ * 258;
        points.set(node.id, {
            x,
            y: offsetY + 28 + depth * 184
        });
        return x;
    }
    // Independent groups run sequentially. Give each its own vertical band
    // instead of treating every root as simultaneous work on one row.
    for (const node of roots) {
        column = 0;
        maxDepth = 0;
        place(node, 0);
        width = Math.max(width, column * 258 + 20);
        offsetY += (maxDepth + 1) * 184 + 40;
    }
    return {
        points,
        dimensions: {
            width,
            height: Math.max(420, offsetY)
        }
    };
}
