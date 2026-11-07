// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const {eligibleRequest, eligibleResponse, CodeCache} = require('../branching/code-cache.cjs');
const origin = 'https://shop.test';
const request = (url = origin + '/static/version123/frontend/Test/en_US/cart.js', headers = {}, method = 'GET') => ({url: () => url, headers: () => headers, method: () => method});
test('cache accepts only public immutable code and rejects private/session variants', () => {
    assert.equal(eligibleRequest(request(), origin), true);
    assert.equal(eligibleRequest(request(origin + '/static/frontend/Test/en_US/template/cart.html'), origin), true);
    for (const req of [request('https://other.test/static/frontend/x.js'), request(origin + '/customer/cart.js'), request(undefined, {authorization: 'secret'}), request(undefined, {}, 'POST')]) {
        assert.equal(eligibleRequest(req, origin), false);
    }
    const valid = {'cache-control': 'max-age=3600, public, immutable', vary: 'Accept-Encoding'};
    assert.equal(eligibleResponse(200, valid), true);
    for (const extra of [{'cache-control': 'public, immutable, private'}, {'cache-control': 'public, no-store, immutable'}, {'set-cookie': 'session=x'}, {vary: 'Cookie'}, {vary: 'Accept-Language'}, {vary: '*'}]) {
        assert.equal(eligibleResponse(200, {...valid, ...extra}), false);
    }
    assert.equal(eligibleResponse(404, valid), false);
});
test('cached code survives context restoration without retaining decoded transport headers', async () => {
    const cache = new CodeCache(origin, 100), contexts = [];
    for (let i = 0; i < 2; i++) {
        const context = {route: async (_, handler) => { contexts.push(handler); }}; await cache.install(context);
    }
    let fetched = 0; const fulfilled = [];
    const route = {request, fetch: async () => {
        fetched++; return {headers: () => ({'cache-control': 'public, immutable', 'content-encoding': 'gzip', 'content-length': '900'}), status: () => 200, body: async () => Buffer.from('test'), dispose: async () => {}};
    }, fulfill: async value => fulfilled.push(value)};
    await contexts[0](route); await contexts[1](route);
    assert.equal(fetched, 1); assert.equal(cache.stats.hits, 1); assert.equal(cache.bytes, 4);
    assert.equal(fulfilled[1].headers['content-encoding'], undefined);
    assert.equal(fulfilled[1].headers['content-length'], undefined);
});
test('cache failures abort the request and remain visible to the browser boundary', async () => {
    const cache = new CodeCache(origin); let handler, aborted = false;
    await cache.install({route: async (_, callback) => { handler = callback; }});
    await handler({request, fetch: async () => { throw new Error('static fetch failed'); }, abort: async () => { aborted = true; }});
    assert.equal(aborted, true); assert.deepEqual(cache.errors, ['static fetch failed']);
});
