// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
for (const provider of ['Compatibility', 'LayoutOverlay']) {
    for (const name of ['custom', 'equal', ...(provider === 'Compatibility' ? ['wireframe', 'untyped'] : [])]) {
        const file = report.files.find(file => file.path === `app/code/MageLens/${provider}/view/frontend/layout/coverageprobe_metadata_${name}.xml`);
        assert.ok(file, `${provider}/${name}`);
        for (const attribute of ['label', ...(name === 'untyped' ? [] : ['design_abstraction'])]) {
            const item = file.declarations.find(item => item.node === `/page/@${attribute}`);
            assert.ok(item, `${provider}/${name}/${attribute}`);
            assert.equal(item.supported, true);
            const kind = attribute === 'label' ? 'label' : 'type';
            assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), name === 'untyped' ? []
                : [`layout-handle-${kind}-evaluated`, provider === 'Compatibility' && name !== 'wireframe'
                    ? 'layout-handle-metadata-overridden' : 'layout-handle-metadata-returned'].sort(), `${provider}/${name}/${attribute}`);
        }
    }
}
assert.ok(report.layout.limitations.some(reason => reason.includes('handle metadata snapshot')));
console.log('Verified native handle metadata evaluation and ordered overrides, with later PHP array consumption explicitly unmeasured.');
