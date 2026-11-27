// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json');
for (const name of ['native', 'getter', 'file', 'resolver', 'engine']) {
    const file = report.files.find(item => item.path.endsWith(`/layout/coverageprobe_templateownership_${name}.xml`));
    assert.ok(file, name);
    const template = file.declarations.find(item => item.layout.kind === 'template');
    const effects = [...new Set(template.evidence.map(event => event.type))].sort();
    assert.deepEqual(effects, name === 'native' ? ['layout-template-executed', 'layout-template-selected']
        : ['layout-template-origin-unconfirmed', 'layout-template-selected'], name);
    assert.equal(template.state, name === 'native' ? 'covered' : 'unmeasured', `${name} requires native execution credit`);
    if (name !== 'native') {
        const events = report.requests.flatMap(request => request.events).filter(event => event.id === template.id);
        assert.equal(events.filter(event => event.type === 'layout-template-executed').length, 0, name);
        assert.ok(events.some(event => event.type === 'layout-template-selected'), name + ': retain the selection fact');
        assert.equal(template.hits, 0, name);
    }
    const block = file.declarations.find(item => item.layout.kind === 'block');
    assert.ok(block.evidence.some(event => event.type === 'layout-block-rendered'), name);
}
console.log('Verified independent template selection and equal-valued rendering input replacement origins.');
