// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const assert = require('node:assert/strict');
const {sourceHashes} = require('./prepare.cjs');
const {badge, cypressBadge, setBadgeSection, formatPercent} = require('./badges.cjs');
const {writeIndex, templateLimitations} = require('./report-index.cjs');
const {writeReport: writeHtmlValidationReport} = require('./html-validation.cjs');
const {writeDatabase} = require('./report-database.cjs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const run = read('coverage/run.json');
const php = read('coverage/php/coverage-summary.json');
const js = read('coverage/js/coverage-summary.json');
const templates = read('coverage/templates/coverage-summary.json');
const xml = read('coverage/xml/coverage.json');
assert.equal(xml.run, run.id);
assert.equal(xml.complete, true);
assert.equal(xml.percent, xml.total ? xml.covered / xml.total * 100 : null, 'Invalid XML coverage percentage');
assert.equal(xml.sourcesUnchanged, true);
assert.deepEqual(xml.collectorErrors, []);
const runner = run.runner || 'cypress';
assert.ok(['cypress', 'playwright'].includes(runner));
const label = runner === 'playwright' ? 'Playwright' : 'Cypress';
const tests = read(`coverage/${runner}-results.json`);
const cli = read('coverage/cli-results.json');
for (const results of [tests, cli]) {
    assert.equal(results.run, run.id);
    assert.equal(results.totalPassed, results.totalTests);
    assert.equal(results.totalFailed, 0);
    assert.equal(results.totalPending, 0);
    assert.equal(results.totalSkipped, 0);
}
assert.ok(tests.totalTests > 0);
assert.equal(php.run, run.id);
assert.ok(php.requests.length > 0, 'No current-run PHP requests were collected');
assert.equal(php.commands.length, cli.commands, 'Missing or extra current-run CLI PHP coverage');
if (php.collection === 'manifest') {
    assert.ok([...php.requests, ...php.commands].every(record => record.mode === 'hit-only'), 'Expected validated native hit-only exports');
}
assert.equal(templates.schemaVersion, 2);
assert.ok(templates.templates.every(template => template.path.endsWith('.html') || template.path.endsWith('.phtml') && template.kind === 'browser-phtml'), 'Only HTML and browser PHTML belong in template coverage');
for (const [covered, total] of [[php.covered, php.total], [js.total.statements.covered, js.total.statements.total], [templates.lines.covered, templates.lines.total], [xml.covered, xml.total]]) {
    assert.ok(Number.isFinite(covered) && Number.isFinite(total) && covered >= 0 && covered <= total, 'Invalid coverage totals');
}
assert.deepEqual(sourceHashes(run.roots), run.sources, 'Original sources changed during instrumentation');
for (const type of ['php', 'js', 'templates', 'xml']) {
    const html = fs.readFileSync(`coverage/${type}/index.html`, 'utf8');
    assert.ok(/<html/i.test(html), `Missing HTML entry point: ${type}`);
}
const metrics = {
    xml: {label: 'XML configuration lines', percent: xml.percent},
    php: {label: 'PHP lines', percent: php.percent},
    js: {label: 'JavaScript statements', percent: js.total.statements.total ? js.total.statements.pct : 0},
    templates: {label: 'Template executable lines', percent: templates.lines.percent}
};
fs.mkdirSync('coverage/badges', {recursive: true});
fs.writeFileSync(`coverage/badges/${runner}.svg`, cypressBadge(tests, runner));
for (const [type, metric] of Object.entries(metrics).filter(([type]) => type !== 'xml')) {
    fs.writeFileSync(`coverage/badges/${type}.svg`, badge(type, metric.percent));
}
const generatedAt = new Date().toISOString();
const htmlValidation = writeHtmlValidationReport(run);
const limitations = templateLimitations(templates);
writeDatabase({run, generatedAt, php, js, templates, templateLimitations: limitations, xml});
fs.writeFileSync('coverage/summary.json', JSON.stringify({run: run.id, generatedAt, metrics, htmlValidation,
    templateLimitations: limitations}, null, 2));
writeIndex({run, generatedAt, metrics, php, js, templates, xml, tests, cli, htmlValidation});
if (process.argv.includes('--update-readme')) setBadgeSection(`[![${label}: ${tests.totalPassed}/${tests.totalTests} passed](coverage/badges/${runner}.svg)](coverage/index.html)\n` + Object.entries(metrics).filter(([type]) => type !== 'xml').map(([type, metric]) =>
    `[![${metric.label}: ${formatPercent(metric.percent)}](coverage/badges/${type}.svg)](coverage/${type}/index.html)`
).join('\n') + `\n\nFull ${label} run: \`${run.id}\` · ${generatedAt}`);
fs.rmSync('coverage/.active-run', {force: true});
console.log('Verified all reports, current PHP collection and unchanged original sources.');
console.log(JSON.stringify(metrics, null, 2));
