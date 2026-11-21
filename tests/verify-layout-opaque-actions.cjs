// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const requests = report.requests.filter(request => request.layoutLimitations?.some(reason => reason.includes('could execute application serialization')));
assert.ok(requests.length, 'Missing native opaque-action measurement limitation');
for (const request of requests) {
    assert.equal(request.events.some(event => event.type === 'layout-action-executed'), false,
        'Opaque programmatic data inferred an original XML action call');
    for (const privateValue of ['opaque_probe', 'LayoutOpaqueActionValue', 'xml-value', 'data-layout-mutation']) {
        assert.equal(JSON.stringify(request.events).includes(privateValue), false, 'Runtime evidence retained application data');
    }
}
assert.ok(report.files.some(file => file.path.endsWith('/layout/coverageprobe_packagemutation_native.xml')),
    'Opaque request dropped the original file inventory');
console.log('Verified opaque native actions retain an explicit attribution limit without inferred XML calls or application values.');
