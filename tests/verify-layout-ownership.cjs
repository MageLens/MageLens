// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));

const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const blog = 'app/code/Application/Blog/view/frontend/layout';
const probe = 'app/code/MageLens/Compatibility/view/frontend/layout';
const hyva = 'vendor/hyva-themes/magento2-default-theme-csp';
const theme = process.argv[3] || 'hyva';
assert.ok(['luma', 'hyva'].includes(theme));

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
        assert.equal(evidence.theme, theme === 'hyva' ? 'frontend/Hyva/default-csp' : 'frontend/Magento/luma');
    }
}

const created = ['layout-block-created', 'layout-block-rendered'];
const executed = ['layout-template-selected', 'layout-template-executed'];
const overridden = ['layout-template-overridden'];
verify(blog, 'blog_index_index', 'application.blog', 'block', 'covered', created);
verify(blog, 'blog_index_index', 'application.blog', 'template', theme === 'hyva' ? 'unmeasured' : 'covered',
    theme === 'hyva' ? overridden : executed);
if (theme === 'hyva') verify(blog, 'hyva_blog_index_index', 'application.blog', 'template', 'covered', executed);

for (const suffix of ['replaced', 'equal']) {
    const name = `magelens.layout.${suffix}`;
    verify(probe, 'coverageprobe_layout_base', name, 'block', 'covered', created);
    verify(probe, 'coverageprobe_layout_base', name, 'template', 'unmeasured', overridden);
    verify(probe, 'coverageprobe_layout_overlay', name, 'template', 'covered', executed);
}
verify(probe, 'coverageprobe_layout_base', 'magelens.layout.late', 'block', 'covered', created);
verify(probe, 'coverageprobe_layout_base', 'magelens.layout.late', 'template', 'unmeasured',
    ['layout-template-selected', 'layout-template-replaced']);
verify(probe, 'coverageprobe_layout_base', 'magelens.layout.unrendered', 'block', 'uncovered', ['layout-block-created']);
verify(probe, 'coverageprobe_layout_base', 'magelens.layout.unrendered', 'template', 'uncovered', ['layout-template-selected']);

if (theme === 'hyva') for (const [module, handle, element] of [
    ['Magento_Catalog', 'catalog_list_item', 'product_list_item'],
    ['Magento_Swatches', 'catalog_list_item', 'category.product.type.details.renderers.configurable'],
    ['Magento_Wishlist', 'default', 'wishlist_sidebar'],
]) {
    const file = report.files.find(item => item.path === `${hyva}/${module}/layout/${handle}.xml`);
    assert.ok(file, `Missing Hyvä layout source ${module}/${handle}`);
    const template = file.declarations.find(item => item.layout?.kind === 'template' && item.layout.element === element);
    assert.ok(template?.evidence.some(evidence => evidence.type === 'layout-template-selected'),
        `Missing native template selection for ${module}/${element}`);
}
for (const kind of ['block', 'template']) {
    verify(probe, 'coverageprobe_layout_unvisited', 'magelens.layout.unvisited', kind, 'uncovered', []);
}
console.log(`Verified exact layout block and template ownership and zero-hit cases on ${theme}.`);
