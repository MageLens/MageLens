// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const {CodeCache} = require('../branching/code-cache.cjs');
test('each browser restoration clears all responses before caching can resume', async () => {
    const cache = new CodeCache(), calls = [], handlers = [];
    const session = {send:async (...args)=>calls.push(args), on:(_,handler)=>handlers.push(handler)};
    await cache.install(session); await cache.install(session);
    assert.deepEqual(calls, [
        ['Network.clearBrowserCache'], ['Network.setCacheDisabled', {cacheDisabled:false}],
        ['Network.clearBrowserCache'], ['Network.setCacheDisabled', {cacheDisabled:false}]
    ]);
    handlers[0](); handlers[1]();
    assert.deepEqual(cache.stats, {mode:'browser-per-branch',hits:2,clears:2});
});
test('a cache-clear failure prevents restoration from enabling stale responses', async () => {
    const cache = new CodeCache(), calls = [];
    await assert.rejects(cache.install({send:async name=>{calls.push(name);throw new Error('clear failed');}}), /clear failed/);
    assert.deepEqual(calls, ['Network.clearBrowserCache']);
    assert.equal(cache.stats.clears, 0);
});
