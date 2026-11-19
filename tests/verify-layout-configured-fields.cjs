// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
function declaration(file, node) {
    const source = report.files.find(entry => entry.path.endsWith('/layout/' + file + '.xml'));
    const item = source?.declarations.find(entry => entry.node === node);
    assert.ok(item, node);
    return item;
}
function covered(file, node, types) {
    const item = declaration(file, node);
    assert.equal(item.state, 'covered', node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), [...types].sort(), node);
}

const configuredData = 'coverageprobe_grammar_configureddata';
const data = '/page/body/block/arguments/argument/argument[2]';
const types = ['layout-argument-type-evaluated'];
covered(configuredData, data, ['layout-configured-argument-evaluated', 'layout-configured-argument-supplied']);
covered(configuredData, data + '/@name', ['layout-configured-argument-supplied']);
covered(configuredData, data + '/@xsi:type', types);
covered(configuredData, data + '/item', ['layout-configured-item-evaluated']);
covered(configuredData, data + '/item/@name', ['layout-configured-item-name-applied']);
covered(configuredData, data + '/item/@xsi:type', types);
for (const [file, node] of [
    [configuredData, '/page/body/block/arguments/argument/argument[1]'],
    ['coverageprobe_layout_arguments', '/page/body/referenceContainer/block/action[3]/argument/argument'],
]) {
    covered(file, node, ['layout-configured-argument-evaluated', 'layout-configured-class-selected']);
    covered(file, node + '/@name', ['layout-configured-class-selected']);
    covered(file, node + '/@xsi:type', types);
}
for (const attribute of ['', '/@name', '/@xsi:type']) {
    const item = declaration('coverageprobe_grammar_configuredarray', '/page/body/block/arguments/argument/item/argument' + attribute);
    assert.equal(item.state, 'unmeasured', item.node);
    assert.equal(item.hits, 0, item.node);
    assert.match(item.reason, /parser does not key/);
}
console.log('Verified configurable object child evaluation and native constructor supply, with an explicit nested parser limit.');
