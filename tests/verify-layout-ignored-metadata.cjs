// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const file = report.files.find(item => item.path.endsWith('/layout/coverageprobe_layout_head.xml'));
assert.ok(file);
const metadata = file.declarations.find(item => item.node === '/page/head/meta[4]');
assert.equal(metadata?.state, 'covered');
assert.deepEqual([...new Set(metadata.evidence.map(event => event.type))], ['layout-metadata-rendered']);
for (const attribute of ['http-equiv', 'charset', 'scheme']) {
    const item = file.declarations.find(item => item.node === '/page/head/meta[4]/@' + attribute);
    assert.equal(item?.state, 'unmeasured', attribute);
    assert.equal(item.hits, 0, attribute);
    assert.deepEqual(item.evidence, [], attribute);
    assert.match(item.reason, /native head reader consumes only the metadata name\/property and content/, attribute);
}
console.log('Verified native metadata output and individually retained ignored http-equiv, charset and scheme attributes.');
