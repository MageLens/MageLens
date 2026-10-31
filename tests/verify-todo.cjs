// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const php = read('coverage/php/merged-lines.json');
const js = read('coverage/js/coverage-summary.json');
const templates = read('coverage/templates/coverage-summary.json');
const results = read('coverage/cypress-results.json');
assert.equal(results.totalFailed, 0);
assert.ok(results.specs.some(spec => spec.path.endsWith('/todo.cy.js')));
for (const suffix of ['Controller/Index/Index.php', 'view/frontend/templates/list.phtml']) {
    const file = Object.keys(php).find(file => file.endsWith('/Vitalii/TodoList/' + suffix));
    assert.ok(file && Object.values(php[file]).includes(1), `Missing PHP execution: ${suffix}`);
}
const unvisited = '/var/www/html/app/code/Vitalii/TodoList/Model/Unvisited.php';
assert.ok(read('coverage/php/coverage-summary.json').undiscovered.includes(unvisited));
assert.ok(fs.readFileSync('coverage/php/clover.xml', 'utf8').includes(unvisited), 'Unvisited PHP file absent from report');
const script = Object.keys(js).find(file => file.endsWith('/Vitalii/TodoList/view/frontend/web/js/list.js'));
assert.ok(script && js[script].lines.covered > 0, 'No TodoList JavaScript execution');
const template = templates.templates.find(file => file.path.endsWith('/Vitalii/TodoList/view/frontend/web/template/list.html'));
assert.ok(template && template.statementSummary.covered > 0 && template.status === 'observed', 'No TodoList template execution');
console.log('PASS: Vitalii/TodoList PHP, JavaScript, template execution, and never-loaded PHP reporting.');
