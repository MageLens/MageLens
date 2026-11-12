// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {fixtureWorkflow} = require('./provider.cjs');

function deepWorkflow(depth = 12) {
    const ids = Array.from({length: depth}, (_, i) => `stage-${String(i).padStart(2, '0')}`);
    const stages = ids.map((id, i) => ({id, parent: ids[i - 1], estimatedMs: i === 0 ? 1 : 1000,
        run: async p => { p.state.db.cart.push(id); p.hit(id); },
        assert: async p => assert.deepEqual(p.state.db.cart, ids.slice(0, i + 1))}));
    const specs = ids.flatMap((parent, i) => [0, 1].map(index => ({id: `test-${i}-${index}`, parent,
        run: async p => p.hit(`test-${i}-${index}`), assert: async p => assert.deepEqual(p.state.db.cart, ids.slice(0, i + 1))})));
    return {...fixtureWorkflow(), stages, specs};
}
module.exports = {deepWorkflow};
