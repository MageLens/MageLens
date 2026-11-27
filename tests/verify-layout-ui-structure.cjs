// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const mode = process.argv[3] || 'developer';
assert.ok(['developer', 'production'].includes(mode));
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_component_index.xml'));
assert.ok(file);
function effects(item, expected) {
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(),
        [...expected, 'layout-xml-ownership-revoked'].sort(), item.node);
}
function instruction(name, attribute = null) {
    const item = file.declarations.find(item => item.layout.instruction === 'uiComponent'
        && item.layout.element === name && item.layout.attribute === attribute);
    assert.ok(item, `${name}/${attribute}`);
    return item;
}
for (const name of ['magelens_layout_ui', 'magelens_layout_ui_before']) {
    const group = instruction(name, 'group');
    assert.equal(group.state, 'covered', name);
    effects(group, ['layout-ui-group-applied']);
    for (const attribute of ['name', 'as']) assert.equal(instruction(name, attribute).state, 'covered');
}
assert.equal(instruction('magelens_layout_ui', 'after').state, 'covered');
assert.equal(instruction('magelens_layout_ui_before', 'before').state, 'covered');
assert.equal(instruction('magelens_layout_ui', 'before').hits, 0);
for (const name of ['magelens_layout_ui_denied', 'magelens_layout_ui_config_denied']) {
    const item = instruction(name);
    assert.equal(item.state, 'unmeasured', name);
    assert.equal(item.hits, 0);
    effects(item, ['layout-ui-denied']);
}
const hidden = instruction('magelens_layout_ui_detached');
assert.equal(hidden.state, 'covered');
effects(hidden, ['layout-ui-created']);
for (const attribute of ['output', 'ttl', 'cacheable']) {
    const item = instruction('magelens_layout_ui', attribute);
    assert.equal(item.state, 'unmeasured');
    assert.equal(item.hits, 0);
    assert.ok(item.reason);
}
const conditions = file.declarations.filter(item => item.layout.instruction === 'visibilityCondition' && item.layout.attribute === null);
assert.equal(conditions.length, 7);
for (const item of conditions) {
    const crossKey = ['other_visibility', 'duck_visibility', 'magic_visibility'].includes(item.layout.element);
    const denied = item.node === instruction('magelens_layout_ui_denied').node + '/visibilityCondition';
    assert.equal(item.state, 'covered', item.node);
    effects(item, [denied ? 'layout-condition-denied' : 'layout-condition-allowed']);
    for (const [attribute, type] of [['name', 'layout-condition-name-applied'], ['className', 'layout-condition-class-selected']]) {
        const field = file.declarations.find(field => field.node === item.node + '/@' + attribute);
        assert.equal(field?.state, crossKey && attribute === 'name' ? 'unmeasured' : 'covered', field?.node);
        effects(field, [crossKey && attribute === 'name' ? 'layout-condition-name-unused' : type]);
    }
    const values = file.declarations.filter(field => field.node.startsWith(item.node + '/arguments/')
        && field.layout.attribute === null && ['argument', 'item'].includes(field.layout.instruction));
    assert.equal(values.length, 3);
    for (const value of values) {
        assert.equal(value.state, crossKey ? 'unmeasured' : 'covered', value.node);
        effects(value, [crossKey ? 'layout-condition-argument-unconsumed' : 'layout-condition-argument-applied']);
    }
}
const rootFile = report.files.find(file => file.path.endsWith('/layout/coverageprobe_grammar_uiroot.xml'));
const root = rootFile?.declarations.find(item => item.layout.kind === 'ui-placement');
assert.ok(root);
assert.equal(root.state, mode === 'developer' ? 'unmeasured' : 'covered');
assert.deepEqual([...new Set(root.evidence.map(event => event.type))],
    [mode === 'developer' ? 'layout-validation-failed' : 'layout-ui-created']);
console.log(`Verified UI ordering, aliases, groups, custom visibility and supplied values, ignored cache/output attributes and ${mode} merged-validation behavior.`);
