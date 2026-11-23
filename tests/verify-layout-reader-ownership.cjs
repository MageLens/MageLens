// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json');
const component = report.files.find(file => file.path.endsWith('/layout/coverageprobe_component_index.xml'));
assert.ok(component);
const conditions = component.declarations.filter(item => item.layout.kind.startsWith('visibility')
    || item.layout.kind.startsWith('condition-'));
assert.ok(conditions.length > 20);
const ids = new Set(conditions.map(item => item.id));
for (const route of ['conditionmutation', 'readermutation']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_${route}_index.xml`));
    const selection = file?.declarations.find(item => item.layout.kind === 'file-selection');
    assert.ok(selection, route);
    const requests = report.requests.filter(request => request.events.some(event => event.id === selection.id));
    assert.ok(requests.length, `${route} native request`);
    for (const request of requests) {
        const events = request.events.filter(event => ids.has(event.id));
        for (const item of conditions.filter(item => item.supported)) {
            assert.ok(events.some(event => event.id === item.id && event.type === 'layout-xml-ownership-revoked'),
                `${route} must revoke ${item.node}`);
        }
        assert.deepEqual([...new Set(events.map(event => event.type))], ['layout-xml-ownership-revoked'],
            `${route} cannot infer ownership from equal-valued replacement metadata or DOM clones`);
    }
}
console.log('Verified native custom-reader and equal-valued parser replacements revoke original XML ownership before conditional effects.');
