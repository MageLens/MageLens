// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));

const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const layout = 'app/code/MageLens/Compatibility/view/frontend/layout';
for (const [handle, declaration, state, expected] of [
    ['coverageprobe_layout_arguments', '/page/body/referenceContainer/block/action[1]', 'covered', ['layout-action-executed']],
    ['coverageprobe_layout_arguments', '/page/body/referenceContainer/block/action[2]', 'uncovered', []],
    ['coverageprobe_layout_arguments', '/page/body/referenceContainer/block/action[3]', 'covered', ['layout-action-executed']],
    ['coverageprobe_layout_arguments_overlay', '/page/body/referenceBlock/action[1]', 'covered', ['layout-action-executed']],
    ['coverageprobe_layout_arguments_overlay', '/page/body/referenceBlock/action[2]', 'unmeasured', ['layout-action-ambiguous']],
    ['coverageprobe_layout_arguments_overlay', '/page/body/referenceBlock/action[3]', 'unmeasured', ['layout-action-ambiguous']],
]) {
    const source = report.files.find(file => file.path === `${layout}/${handle}.xml`);
    assert.ok(source, `Missing action source ${handle}`);
    const item = source.declarations.find(item => item.node === declaration);
    assert.ok(item, `Missing action declaration ${declaration}`);
    assert.equal(item.state, state, declaration);
    assert.equal(item.hits > 0, state === 'covered', declaration);
    assert.deepEqual([...new Set(item.evidence.map(entry => entry.type))], expected, declaration);
    assert.ok(item.evidence.every(entry => entry.area === 'frontend'), declaration);
    const method = source.declarations.find(item => item.node === declaration + '/@method');
    assert.equal(method?.state, state, declaration + '/@method');
    assert.deepEqual([...new Set(method.evidence.map(entry => entry.type))], expected, declaration + '/@method');
}
console.log('Verified native scalar and configurable-object action calls and zero hits for the guarded and ambiguous actions.');
