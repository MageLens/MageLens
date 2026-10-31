// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Optional regression checks for the bundled demonstration suite.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const php = read('coverage/php/coverage-summary.json');
const js = read('coverage/js/coverage-summary.json');
const templates = read('coverage/templates/coverage-summary.json');
const themePaths = read('coverage/project-fixtures.json').Application_Blog.themePaths;
const demoThemeActive = themePaths[0] === 'Application/coverage';
const hyva = themePaths.includes('Hyva/default-csp');
const expectedTemplates = hyva ? ['templates/blog-hyva.phtml', 'web/template/editor-preview.html'] :
    ['web/template/list.html', 'web/template/details.html', 'web/html/favorite.html', 'web/template/editor-preview.html'];
if (demoThemeActive) expectedTemplates.push('web/template/theme-note.html');
assert.ok(php.covered > 0 && php.covered < php.total);
for (const route of ['/application_blog/manage/save/', '/blog/post/comment/']) {
    assert.ok(php.requests.some(request => request.method === 'POST' && request.uri.includes(route)), `Missing real PHP POST collection: ${route}`);
}
if (php.collection === 'manifest') {
    assert.ok(php.requests.every(request => request.mode === 'hit-only'), 'Expected validated native hit-only exports');
    assert.ok(php.cache.hit > 0, 'The repeated GETs did not show native export cache reuse');
}
assert.ok(js.total.lines.covered > 0 && js.total.lines.covered < js.total.lines.total);
assert.ok(!Object.keys(js).some(file => /\.(cy|spec)\.[jt]s$/.test(file) || file.includes('/Test/')), 'Browser tests must not contribute to application coverage');
for (const suffix of [`view/frontend/web/js/${hyva ? 'blog-hyva' : 'blog'}.js`, 'view/adminhtml/web/js/editor.js', 'view/adminhtml/web/js/confirm-delete.js']) {
    const file = Object.keys(js).find(file => file.endsWith('/Application/Blog/' + suffix));
    assert.ok(file && js[file].lines.covered > 0, `Missing browser execution: ${suffix}`);
}
assert.ok(templates.records > 0 && templates.summary.covered > 0);
assert.equal(templates.schemaVersion, 2);
assert.ok(templates.lines.covered > 0 && templates.lines.covered < templates.lines.total);
assert.ok(templates.statements.covered > 0 && templates.statements.covered < templates.statements.total);
assert.ok(templates.templates.every(template => template.path.endsWith('.html') || template.kind === 'browser-phtml'), 'Only browser directives belong in the template report');
for (const suffix of expectedTemplates) {
    assert.ok(templates.templates.some(t => t.path.endsWith(suffix) && t.status === 'observed'), `Missing DOM hit: ${suffix}`);
}
if (demoThemeActive) assert.ok(templates.templates.some(t => t.path.includes('app/design/') && t.status === 'observed'));
assert.ok(templates.templates.some(t => t.path.endsWith('editorial-preview.html') && t.status === 'unobserved'));
for (const suffix of expectedTemplates) {
    const entry = templates.templates.find(template => template.path.endsWith(suffix));
    assert.ok(entry.statementSummary.covered > 0, `Missing binding execution: ${suffix}`);
    assert.ok(fs.statSync(`coverage/templates/files/${entry.id}.html`).size > 0);
}
assert.ok(templates.directories.some(directory => directory.path === 'app/code'));
if (templates.templates.some(template => template.path.startsWith('app/design/'))) {
    assert.ok(templates.directories.some(directory => directory.path === 'app/design'));
}
if (!hyva) assert.ok(templates.templates.find(template => template.path.endsWith('web/html/favorite.html')).statements.some(statement => statement.syntax === 'underscore:escape' && statement.hits > 0));
const listTemplate = templates.templates.find(template => template.path.endsWith(hyva ? 'templates/blog-hyva.phtml' : 'web/template/list.html'));
if (hyva) {
    for (const marker of ['data-cy="search"', 'data-cy="category"', 'data-cy="favorite"', 'data-cy="post-body"', 'data-cy="page-number"']) {
        const line = listTemplate.source.split('\n').findIndex(line => line.includes(marker)) + 1;
        assert.ok(listTemplate.lineHits[line]?.hits > 0, `Missing Alpine execution: ${marker}`);
    }
}
const unusedLine = listTemplate.source.split('\n').findIndex(line => line.includes('data-cy="unpublished-post"')) + 1;
assert.equal(listTemplate.lineHits[unusedLine].hits, 0, 'A false conditional body must have zero binding evaluations');
assert.equal(templates.templates.find(t => t.path.endsWith('editorial-preview.html')).statementSummary.covered, 0);
console.log('Verified demo-specific execution and uncovered examples.');
