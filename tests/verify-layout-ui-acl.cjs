// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const file = report.files.find(item => item.path === 'app/code/MageLens/Compatibility/view/adminhtml/layout/adminhtml_dashboard_index.xml');
assert.ok(file);
for (const suffix of ['dashboard', 'blog']) {
    const name = 'magelens_layout_ui_acl_' + suffix;
    const placement = file.declarations.find(item => item.layout.kind === 'ui-placement' && item.layout.element === name);
    const condition = file.declarations.find(item => item.layout.kind === 'condition-aclResource' && item.layout.element === name);
    assert.ok(placement?.hits > 0, name);
    assert.deepEqual([...new Set(placement.evidence.map(event => event.type))].sort(),
        suffix === 'dashboard' ? ['layout-ui-created', 'layout-ui-rendered']
            : ['layout-ui-created', 'layout-ui-denied', 'layout-ui-rendered']);
    assert.deepEqual([...new Set(condition?.evidence.map(event => event.type))].sort(), suffix === 'dashboard'
        ? ['layout-condition-allowed'] : ['layout-condition-allowed', 'layout-condition-denied']);
    if (suffix === 'blog') {
        const denied = report.requests.filter(request => request.events.some(event =>
            event.id === condition.id && event.type === 'layout-condition-denied'));
        assert.ok(denied.length > 0);
        assert.ok(denied.every(request => !request.events.some(event => event.id === placement.id
            && ['layout-ui-created', 'layout-ui-rendered'].includes(event.type))));
    }
}
console.log('Verified real Admin ACL permits UI placement and suppresses denied component construction and rendering.');
