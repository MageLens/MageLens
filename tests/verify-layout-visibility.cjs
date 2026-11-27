// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json');
for (const [fileSuffix, name, attribute, effects] of [
    ['coverageprobe_layout_structure.xml', 'config-allowed', 'ifconfig', ['layout-condition-allowed']],
    ['coverageprobe_layout_structure.xml', 'config-denied', 'ifconfig', ['layout-condition-denied']],
    ['adminhtml_dashboard_index.xml', 'acl-dashboard', 'aclResource', ['layout-condition-allowed']],
    ['adminhtml_dashboard_index.xml', 'acl-blog', 'aclResource', ['layout-condition-allowed', 'layout-condition-denied']],
    ['adminhtml_dashboard_index.xml', 'acl-alias', 'acl', ['layout-condition-allowed', 'layout-condition-denied']],
]) {
    const file = report.files.find(file => file.path.endsWith('/layout/' + fileSuffix));
    const declaration = file?.declarations.find(item => item.layout?.element === 'magelens.layout.' + name
        && item.layout.attribute === attribute);
    assert.ok(declaration, `Missing condition source ${name}`);
    assert.equal(declaration.state, 'covered', name);
    assert.deepEqual([...new Set(declaration.evidence.map(event => event.type))].sort(), effects, name);
    const block = file.declarations.find(item => item.layout?.kind === 'block' && item.layout.element === 'magelens.layout.' + name);
    if (effects.includes('layout-condition-denied')) {
        const denied = report.requests.filter(request => request.events.some(event =>
            event.id === declaration.id && event.type === 'layout-condition-denied'));
        assert.ok(denied.length);
        assert.ok(denied.every(request => !request.events.some(event => event.id === block.id && event.type === 'layout-block-created')),
            `Denied condition still generated ${name}`);
    }
}
console.log('Verified native configuration and real Admin ACL outcomes, the deprecated alias, and denied block construction.');
