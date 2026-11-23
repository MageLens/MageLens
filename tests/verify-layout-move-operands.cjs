// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const cases = ['after', 'before', 'equal', 'precedence', 'missing', 'destination', 'removed', 'programmatic', 'same', 'unchanged', 'sibling-missing', 'alias-fallback']
    .map(variant => ['Compatibility', variant]);
cases.push(['Compatibility', 'overridden'], ['LayoutOverlay', 'overridden']);
for (const [module, variant] of cases) {
    const source = report.files.find(file => file.path === `app/code/MageLens/${module}/view/frontend/layout/coverageprobe_moveoperands_${variant}.xml`);
    assert.ok(source, variant);
    const move = source.declarations.find(item => item.node === '/layout/move');
    const attributes = source.declarations.filter(item => item.layout.ordinal === move.layout.ordinal && item.layout.attribute)
        .map(item => item.layout.attribute);
    for (const attribute of [null, ...attributes]) {
        const item = source.declarations.find(item => item.node === '/layout/move' + (attribute ? '/@' + attribute : ''));
        let effect = attribute === 'as' ? 'alias-applied' : ['before', 'after'].includes(attribute) ? 'order-applied' : 'applied';
        if (variant === 'removed' && attribute === null) effect = 'removed';
        if (variant === 'equal' && attribute === 'as') effect = 'alias-unchanged';
        if (['equal', 'precedence', 'removed'].includes(variant) && attribute === 'after') effect = 'order-unchanged';
        if (variant === 'precedence' && attribute === 'before') effect = 'ignored';
        if (variant === 'missing') effect = 'target-missing';
        if (variant === 'destination') effect = [null, 'element'].includes(attribute) ? 'detached' : 'destination-missing';
        if (variant === 'same' && attribute === 'destination') effect = 'unchanged';
        if (variant === 'unchanged' && [null, 'element', 'destination'].includes(attribute)) effect = 'unchanged';
        if (variant === 'unchanged' && attribute === 'as') effect = 'alias-unchanged';
        if (['same', 'unchanged', 'sibling-missing'].includes(variant) && attribute === 'after') effect = 'order-unchanged';
        if (variant === 'programmatic') effect = 'replaced';
        if (variant === 'overridden' && module === 'Compatibility') effect = 'overridden';
        const covered = ['applied', 'removed', 'detached', 'alias-applied', 'order-applied'].includes(effect);
        assert.equal(item?.layout.kind, attribute ? 'move-' + attribute : 'move', variant + ':' + attribute);
        assert.equal(item?.state, covered ? 'covered' : 'unmeasured', variant + ':' + attribute);
        assert.equal(item.hits > 0, covered, variant + ':' + attribute);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-move-' + effect], variant + ':' + attribute);
        assert.ok(item.evidence.every(event => event.area === 'frontend'));
    }
}
const never = report.files.find(file => file.path.endsWith('/layout/coverageprobe_moveoperands_never.xml'));
assert.ok(never, 'Eligible unvisited move file must remain in the report');
const unvisited = never.declarations.filter(item => item.layout.instruction === 'move');
assert.equal(unvisited.length, 5);
for (const item of unvisited) {
    assert.equal(item.supported, true);
    assert.equal(item.state, 'uncovered');
    assert.equal(item.hits, 0);
    assert.deepEqual(item.evidence, []);
}
console.log('Verified move operands, equal aliases, native precedence, detachment, removed subtrees and equal PHP rescheduling.');
