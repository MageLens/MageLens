// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_nestedarguments.xml'));
assert.ok(file, 'Missing original named parameter inventory');
const parameters = file.declarations.filter(item => ['parameter', 'parameter-name'].includes(item.layout.kind));
assert.equal(parameters.length, 10);
const counts = [0, 0];
for (const item of parameters) {
    const ignored = item.node.includes('/arguments[2]/');
    counts[Number(ignored)]++;
    const effects = [...new Set(item.evidence.map(event => event.type))].sort();
    if (ignored) {
        assert.equal(item.hits, 0, item.node);
        assert.equal(item.state, 'unmeasured', item.node);
        assert.deepEqual(effects, ['layout-argument-group-ignored'], item.node);
    } else {
        assert.equal(item.state, 'covered', item.node);
        assert.deepEqual(effects, [item.layout.kind === 'parameter' ? 'layout-parameter-evaluated' : 'layout-parameter-name-applied'], item.node);
    }
}
assert.deepEqual(counts, [6, 4]);
console.log('Verified independent native helper/URL parameter evaluation, name-map assignment and ignored original operands.');

const fixture = '/view/frontend/layout/coverageprobe_named_parameter_overlay.xml';
const effects = {
    evaluated: 'layout-parameter-evaluated',
    name: 'layout-parameter-name-applied',
    overridden: 'layout-parameter-overridden',
    inherited: 'layout-parameter-value-inherited',
};
for (const [module, pairs] of Object.entries({
    Compatibility: [
        ['overridden', 'overridden'], ['evaluated', 'overridden'], ['overridden', 'overridden'],
        ['evaluated', 'name'], ['evaluated', 'name'], ['evaluated', 'name'], ['evaluated', 'name'],
        [null, null], [null, null],
    ],
    LayoutOverlay: [['evaluated', 'name'], ['inherited', 'name']],
})) {
    const overlay = report.files.find(entry => entry.path.endsWith('/MageLens/' + module + fixture));
    assert.ok(overlay, module + ' parameter inventory');
    const operands = overlay.declarations.filter(item => ['parameter', 'parameter-name'].includes(item.layout.kind));
    assert.equal(operands.length, pairs.length * 2);
    for (const [index, operand] of operands.entries()) {
        const effect = pairs[Math.floor(index / 2)][index % 2];
        assert.deepEqual([...new Set(operand.evidence.map(event => event.type))], effect ? [effects[effect]] : [], operand.node);
        assert.equal(operand.state, ['evaluated', 'name'].includes(effect) ? 'covered' : effect ? 'unmeasured' : 'uncovered', operand.node);
    }
    if (module !== 'Compatibility') continue;
    for (const [kind, effect, count] of [
        ['action-item', 'layout-action-item-evaluated', 3],
        ['action-item-name', 'layout-action-item-name-applied', 3],
        ['argument-type', 'layout-argument-type-evaluated', 3],
        ['argument-helper', 'layout-argument-modifier-evaluated', 1],
        ['argument-translate', 'layout-argument-modifier-evaluated', 1],
    ]) {
        const items = overlay.declarations.filter(item => item.layout.kind === kind && item.node.includes('/item[')
            && !item.node.includes('/param'));
        assert.equal(items.length, count, kind);
        for (const item of items) assert.deepEqual([...new Set(item.evidence.map(event => event.type))], [effect], item.node);
    }
}
console.log('Verified split overlay origins, duplicate and empty parameters, native action array items and guarded zero hits.');
