// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const file = report.files.find(file => file.path.endsWith('/layout/coverageprobe_argumentgroups.xml'));
assert.ok(file, 'Missing repeated argument group inventory');
for (const parent of ['/layout/container/block', '/layout/referenceBlock']) {
    for (const position of [1, 2]) {
        const node = `${parent}/arguments[${position}]`;
        const group = file.declarations.find(item => item.node === node);
        assert.equal(group?.layout.kind, 'argument-group', node);
        assert.equal(group.state, position === 1 ? 'covered' : 'unmeasured', node);
        assert.equal(group.hits > 0, position === 1, node);
        assert.deepEqual([...new Set(group.evidence.map(event => event.type))],
            [position === 1 ? 'layout-argument-group-selected' : 'layout-argument-group-ignored'], node);
        for (const item of file.declarations.filter(item => item.supported && item.node.startsWith(node + '/'))) {
            if (position === 1) {
                assert.equal(item.state, 'covered', item.node);
            } else {
                assert.equal(item.hits, 0, item.node);
                assert.equal(item.state, 'unmeasured', item.node);
                assert.deepEqual([...new Set(item.evidence.map(event => event.type))], ['layout-argument-group-ignored'], item.node);
            }
        }
    }
}
console.log('Verified original selected and ignored argument groups, supplied values and independent zero-hit descendant operands.');
