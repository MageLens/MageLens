// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json');
const file = report.files.find(item => item.path.endsWith('/layout/coverageprobe_cachepage_index.xml'));
assert.ok(file);
for (const kind of ['container', 'block', 'argument']) {
    const item = file.declarations.find(item => item.layout.kind === kind);
    assert.ok(item?.hits > 0, kind);
}
const cached = report.requests.filter(request => request.layoutLimitations?.some(reason =>
    reason.startsWith('A native full-page cache lookup returned a response.')));
assert.ok(cached.length > 0, 'Native full-page cache response lacks an explicit origin limitation');
for (const request of cached) {
    assert.equal(request.events.some(event => event.type.startsWith('layout-')), false,
        'Cached response inferred fresh layout effects');
}
console.log('Verified native full-page cache bypass retains cold XML effects and zero inferred warm layout execution.');
