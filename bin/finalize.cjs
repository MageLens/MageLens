// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const assert = require('node:assert/strict');
const {sourceHashes} = require('./prepare.cjs');
const {badge, cypressBadge, setBadgeSection} = require('./badges.cjs');
const {writeIndex, templateLimitations} = require('./report-index.cjs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const run = read('coverage/run.json');
const php = read('coverage/php/coverage-summary.json');
const js = read('coverage/js/coverage-summary.json');
const templates = read('coverage/templates/coverage-summary.json');
const runner = run.runner || 'cypress';
assert.ok(['cypress', 'playwright'].includes(runner));
const label = runner === 'playwright' ? 'Playwright' : 'Cypress';
const tests = read(`coverage/${runner}-results.json`);
assert.equal(tests.run, run.id);
assert.ok(tests.totalTests > 0);
assert.equal(tests.totalPassed, tests.totalTests);
assert.equal(tests.totalFailed, 0);
assert.equal(tests.totalPending, 0);
assert.equal(tests.totalSkipped, 0);
assert.equal(php.run, run.id);
assert.ok(php.requests.length > 0, 'No current-run PHP requests were collected');
if (php.collection === 'manifest') assert.ok(php.requests.every(request => request.mode === 'hit-only'), 'Expected validated native hit-only exports');
assert.equal(templates.schemaVersion, 2);
assert.ok(templates.templates.every(template => template.path.endsWith('.html') || template.path.endsWith('.phtml') && template.kind === 'browser-phtml'), 'Only HTML and browser PHTML belong in template coverage');
for (const [covered, total] of [[php.covered, php.total], [js.total.statements.covered, js.total.statements.total], [templates.lines.covered, templates.lines.total]]) {
    assert.ok(Number.isFinite(covered) && Number.isFinite(total) && covered >= 0 && covered <= total, 'Invalid coverage totals');
}
assert.deepEqual(sourceHashes(run.roots), run.sources, 'Original sources changed during instrumentation');
for (const type of ['php', 'js', 'templates']) {
    const html = fs.readFileSync(`coverage/${type}/index.html`, 'utf8');
    assert.ok(/<html/i.test(html), `Missing HTML entry point: ${type}`);
}
const metrics = {
    php: {label: 'PHP lines', percent: php.percent},
    js: {label: 'JavaScript statements', percent: js.total.statements.total ? js.total.statements.pct : 0},
    templates: {label: 'Template executable lines', percent: templates.lines.percent}
};
fs.mkdirSync('coverage/badges', {recursive: true});
fs.writeFileSync(`coverage/badges/${runner}.svg`, cypressBadge(tests, runner));
for (const [type, metric] of Object.entries(metrics)) {
    fs.writeFileSync(`coverage/badges/${type}.svg`, badge(type, metric.percent));
}
const generatedAt = new Date().toISOString();
fs.writeFileSync('coverage/summary.json', JSON.stringify({run: run.id, generatedAt, metrics,
    templateLimitations: templateLimitations(templates)}, null, 2));
writeIndex({run, generatedAt, metrics, php, js, templates, tests});
setBadgeSection(`[![${label}: ${tests.totalPassed}/${tests.totalTests} passed](coverage/badges/${runner}.svg)](coverage/index.html)\n` + Object.entries(metrics).map(([type, metric]) =>
    `[![${metric.label}: ${metric.percent.toFixed(2)}%](coverage/badges/${type}.svg)](coverage/${type}/index.html)`
).join('\n') + `\n\nFull ${label} run: \`${run.id}\` · ${generatedAt}`);
fs.rmSync('coverage/.active-run', {force: true});
console.log('Verified all reports, current HTTP collection and unchanged original sources.');
console.log(JSON.stringify(metrics, null, 2));
