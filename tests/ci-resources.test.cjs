// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {requireResources} = require('./ci/resources.cjs');

test('ample host resources cannot hide an undersized Docker VM', () => {
    const host = {freeGiB: 100, memoryGiB: 14};
    assert.doesNotThrow(() => requireResources({host, engine: {freeGiB: 25, memoryGiB: 6}}));
    for (const engine of [{freeGiB: 24, memoryGiB: 8}, {freeGiB: 40, memoryGiB: 4}, {freeGiB: NaN, memoryGiB: 8}]) {
        assert.throws(() => requireResources({host, engine}), /Insufficient engine resources/);
    }
});

test('ample VM resources cannot hide an exhausted host drive', () => {
    assert.throws(() => requireResources({host: {freeGiB: 8, memoryGiB: 16}, engine: {freeGiB: 100, memoryGiB: 8}}),
        /Insufficient host resources/);
});
