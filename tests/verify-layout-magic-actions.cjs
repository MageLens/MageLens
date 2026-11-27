// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const file = report.files.find(file => file.path === 'app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_magicactions.xml');
assert.ok(file, 'Original magic action source');
function check(node, kind, covered, types) {
    const item = file.declarations.find(item => item.node === node);
    assert.ok(item, node);
    assert.equal(item.layout.kind, kind, node);
    assert.equal(item.hits > 0, covered, node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), types.sort(), node);
    assert.ok(item.evidence.every(event => event.area === 'frontend'), node);
}
for (const name of ['empty', 'zero', 'denied', 'unrendered']) {
    const block = file.declarations.find(item => item.layout.kind === 'block' && item.layout.element === `magelens.magic.action.${name}`);
    assert.ok(block, name);
    check(block.node, 'block', name !== 'unrendered', ['layout-block-created', ...(name !== 'unrendered' ? ['layout-block-rendered'] : [])]);
    const action = block.node + '/action';
    for (const [node, kind] of [[action, 'action'], [action + '/@method', 'action-method']]) {
        check(node, kind, name !== 'denied', name === 'denied' ? [] : ['layout-action-executed']);
    }
    check(action + '/argument', 'action-argument', name !== 'denied', name === 'denied' ? [] : ['layout-action-argument-applied']);
    check(action + '/argument/@name', 'action-argument-name', name !== 'denied', name === 'denied' ? [] : ['layout-action-argument-name-applied']);
    if (['empty', 'denied'].includes(name)) check(action + '/@ifconfig', 'action-ifconfig', true, [`layout-action-condition-${name === 'empty' ? 'allowed' : 'denied'}`]);
}
console.log('Verified original empty/zero action methods, guard decisions and execution independent of target rendering.');
