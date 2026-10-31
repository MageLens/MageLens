// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Acceptance check after the full demo suite, also usable with the alternate test theme.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const theme = process.argv[2] || 'Application/coverage';
const results = read('coverage/cypress-results.json');
const fixtures = read('coverage/project-fixtures.json').Application_Blog;
assert.equal(fixtures.themePaths[0], theme, 'The suite did not use the selected theme');
assert.equal(results.totalTests, 5);
assert.equal(results.totalPassed, 5);
assert.equal(results.totalFailed, 0);
const php = read('coverage/php/merged-lines.json');
const phpFiles = [...fs.readFileSync('coverage/php/clover.xml', 'utf8').matchAll(/<file name="([^"]+)"/g)].map(match => match[1]);
const js = read('coverage/js/coverage-summary.json');
const templates = read('coverage/templates/coverage-summary.json').templates;
assert.ok(phpFiles.length > 0, 'PHP report has no source files');
for (const file of phpFiles) assert.match(file, /^\/source\/app\/(code|design)\//, `PHP outside application scope: ${file}`);
for (const file of Object.keys(js).filter(file => file !== 'total')) assert.match(file, /^\/workspace\/src\/app\/(code|design)\//, `JavaScript outside application scope: ${file}`);
for (const file of templates) assert.match(file.path, /^app\/(code|design)\//, `Template outside application scope: ${file.path}`);
const themeRoot = `app/design/frontend/${theme}/`;
assert.ok(Object.entries(php).some(([file, lines]) => file.includes(themeRoot) && file.endsWith('.phtml') && Object.values(lines).includes(1)), 'Selected theme PHP did not execute');
assert.ok(templates.some(file => file.path.startsWith(themeRoot) && file.status === 'observed' && file.statementSummary.covered > 0), 'Selected theme HTML bindings did not execute');
if (theme !== 'Application/coverage') {
    assert.ok(!phpFiles.some(file => file.includes('app/design/frontend/Application/coverage/')), 'Inactive demo theme must not enter PHP coverage');
    assert.ok(!Object.keys(js).some(file => file.includes('app/design/frontend/Application/coverage/')), 'Inactive demo theme must not enter JavaScript coverage');
    assert.ok(!templates.some(file => file.path.includes('app/design/frontend/Application/coverage/')), 'Inactive demo theme must not enter template coverage');
}
console.log(`PASS: all five tests use ${theme}; app/code and app/design are reported; vendor is excluded.`);
