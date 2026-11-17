// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');

const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
const blog = 'app/code/Application/Blog/view/frontend/layout';
const probe = 'app/code/MageLens/Compatibility/view/frontend/layout';

function verify(directory, handle, element, kind, state, types) {
    const file = report.files.find(item => item.path === `${directory}/${handle}.xml`);
    assert.ok(file, `Missing layout source ${handle}`);
    const matches = file.declarations.filter(item => item.layout?.element === element && item.layout.kind === kind);
    assert.equal(matches.length, 1, `Missing unique ${kind} origin for ${handle}/${element}`);
    const [item] = matches;
    assert.equal(item.state, state, `${handle}/${element}/${kind}`);
    assert.ok(item.startLine > 0 && item.endLine >= item.startLine);
    assert.deepEqual([...new Set(item.evidence.map(evidence => evidence.type))].sort(), types.sort(),
        `${handle}/${element}/${kind} evidence`);
    for (const evidence of item.evidence) {
        assert.equal(evidence.area, 'frontend');
        assert.equal(evidence.theme, 'frontend/Hyva/default-csp');
    }
}

const created = ['layout-block-created', 'layout-block-rendered'];
const executed = ['layout-template-selected', 'layout-template-executed'];
const overridden = ['layout-template-overridden'];
verify(blog, 'blog_index_index', 'application.blog', 'block', 'covered', created);
verify(blog, 'blog_index_index', 'application.blog', 'template', 'unmeasured', overridden);
verify(blog, 'hyva_blog_index_index', 'application.blog', 'template', 'covered', executed);

for (const suffix of ['replaced', 'equal']) {
    const name = `magelens.layout.${suffix}`;
    verify(probe, 'coverageprobe_layout_base', name, 'block', 'covered', created);
    verify(probe, 'coverageprobe_layout_base', name, 'template', 'unmeasured', overridden);
    verify(probe, 'coverageprobe_layout_overlay', name, 'template', 'covered', executed);
}
verify(probe, 'coverageprobe_layout_base', 'magelens.layout.late', 'block', 'covered', created);
verify(probe, 'coverageprobe_layout_base', 'magelens.layout.late', 'template', 'covered',
    ['layout-template-selected', 'layout-template-replaced']);
verify(probe, 'coverageprobe_layout_base', 'magelens.layout.unrendered', 'block', 'covered', ['layout-block-created']);
verify(probe, 'coverageprobe_layout_base', 'magelens.layout.unrendered', 'template', 'covered', ['layout-template-selected']);
for (const kind of ['block', 'template']) {
    verify(probe, 'coverageprobe_layout_unvisited', 'magelens.layout.unvisited', kind, 'uncovered', []);
}
console.log('Verified exact layout block and template ownership and zero-hit cases on Hyvä CSP.');
