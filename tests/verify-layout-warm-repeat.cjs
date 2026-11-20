// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {countsAsLayoutCoverage} = require('../bin/report-xml.cjs');

const firstRun = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const warm = JSON.parse(fs.readFileSync('coverage/xml/coverage.json', 'utf8'));
const run = JSON.parse(fs.readFileSync('coverage/run.json', 'utf8'));
assert.notEqual(run.id, firstRun.run, 'Warm repeat reused a prior run ID');
assert.equal(warm.run, run.id);
assert.equal(warm.complete, true);
assert.equal(warm.sourcesUnchanged, true);
assert.deepEqual(warm.collectorErrors, []);

const declarations = new Set(warm.files
    .filter(file => /\/Application\/Blog\/view\/frontend\/layout\/blog_(?:index_index|post_view)\.xml$/.test(file.path))
    .flatMap(file => file.declarations.map(item => item.id)));
assert.ok(declarations.size > 0, 'Original storefront layout inventory is missing');
const affected = warm.files.flatMap(file => file.declarations).filter(item => declarations.has(item.id));
assert.ok(affected.some(item => item.state === 'unmeasured' && /cache|confirmed trace/.test(item.reason || '')),
    'Cached storefront handles have no scoped declaration limitation');
const requests = warm.requests.filter(request => request.layoutLimitations?.some(reason =>
    /merged handle update|layout schedule from cache|full-page cache lookup/.test(reason)));
assert.ok(requests.length, 'Warm repeat observed no cached layout execution');
for (const request of requests) {
    const fresh = request.events.filter(event => declarations.has(event.id) && countsAsLayoutCoverage(event.type));
    assert.deepEqual(fresh, [], `Cached request ${request.id} inferred fresh storefront XML effects`);
}
console.log(`Verified warm publication run identity and zero fresh storefront effects across ${requests.length} cached requests.`);
