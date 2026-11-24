// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const [handle, state, effects] of [
    ['cachefalse', 'covered', ['layout-cacheability-denied']],
    ['cacheremoved', 'unmeasured', ['layout-cacheability-target-missing']],
    ['cachezero', 'unmeasured', []],
]) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_grammar_${handle}.xml`));
    const item = file?.declarations.find(item => item.layout?.attribute === 'cacheable');
    assert.ok(item, `Missing cacheability fixture ${handle}`);
    assert.equal(item.state, state, handle);
    assert.equal(item.hits > 0, state === 'covered', handle);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))], effects, handle);
}
console.log('Verified native page-cache denial, removed noncacheable blocks and the distinct literal-zero behavior.');
