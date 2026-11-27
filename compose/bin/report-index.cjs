// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {formatPercent} = require('./badges.cjs');
const {types} = require('./combined-report/data.cjs');

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function templateLimitations(templates) {
    return {
        directives: templates.templates.flatMap(entry => (entry.unsupportedDirectives || []).map(reason => ({path: entry.path, reason}))),
        scripts: templates.scripts?.unsupported || [],
        generated: templates.scripts?.generated || []
    };
}

function writeIndex({run, generatedAt, combined, templates, xml, tests, cli, htmlValidation}) {
    const runner = run.runner === 'playwright' ? 'Playwright' : 'Cypress';
    const reports = [
        ...Object.entries(types).map(([key, label]) => ({label, ...combined.totals[key]})),
        {label: 'Overall line coverage (PHP, JavaScript and templates)', ...combined.overall},
        ...(xml ? [{label: 'XML configuration lines', href: 'xml/index.html', covered: xml.covered, total: xml.total}] : [])
    ];
    const rows = reports.map(report => {
        const percent = report.total ? report.covered / report.total * 100 : null;
        const track = percent === null ? '' : `<div class="track" aria-hidden="true"><span style="width:${percent.toFixed(2)}%"></span></div>`;
        const label = report.href ? `<a href="${report.href}">${report.label} <span aria-hidden="true">↗</span></a>` : report.label;
        return `<tr>
<th scope="row">${label}</th>
<td>${report.covered} / ${report.total}</td>
<td>${report.total - report.covered}</td>
<td><strong>${formatPercent(percent)}</strong>${track}</td>
</tr>`;
    }).join('\n');
    const javascriptDetails = fs.existsSync('coverage/javascript-summary.json') ? `<p>JavaScript groups: <a href="js-application/index.html">application</a> · <a href="js-libraries/index.html">bundled libraries</a>. <a href="javascript-summary.json">Group totals</a> · <a href="javascript-scope.json">Scope and exclusion reasons</a>.</p>` : '';
    const templateDetails = templates.scripts ? `<p>Template scripts: ${templates.scripts.instrumented} instrumented, ${templates.scripts.unsupported.length} unsupported and ${templates.scripts.generated.length} unmapped PHP-generated fragments. <a href="templates/coverage-summary.json">Template coverage data</a>.</p>` : '';
    const presence = templates.records
        ? `DOM presence: ${templates.summary.covered}/${templates.summary.eligible} templates (${templates.summary.percent}%).`
        : 'DOM presence: no observation records collected.';
    const gaps = templateLimitations(templates);
    const templateWarning = Object.values(gaps).some(items => items.length) ? `<p class="note"><strong>Template measurement is partial.</strong> ${gaps.directives.length} unsupported directives, ${gaps.scripts.length} unsupported scripts and ${gaps.generated.length} unmapped PHP outputs are not fully measured. The percentage covers instrumented constructs only. <a href="templates/coverage-summary.json">Inspect the affected files and reasons</a>.</p>` : '';
    // An unaudited run has no report to open and must not read as a clean result.
    const htmlValidationRow = htmlValidation.audits ? `<tr>
<th scope="row"><a href="html-validation/index.html">HTML validation <span aria-hidden="true">↗</span></a><small>HTML source of the pages for which a test called mageLensValidateHtml.</small></th>
<td>${htmlValidation.audits} audits<small>${htmlValidation.pages} pages</small></td>
<td>${htmlValidation.errors} errors<small>${htmlValidation.warnings} warnings${htmlValidation.notValidated ? ` · ${htmlValidation.notValidated} not validated` : ''}</small></td>
</tr>` : `<tr>
<th scope="row">HTML validation<small>HTML source of the pages for which a test called mageLensValidateHtml.</small></th>
<td colspan="2">Not run<small>No test called mageLensValidateHtml, so no page was audited.</small></td>
</tr>`;
    fs.writeFileSync('coverage/index.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MageLens coverage report</title>
<style>
:root { color-scheme: light; font-family: system-ui, sans-serif; color: #172b3a; background: #f3f6f8; }
* { box-sizing: border-box; }
body { margin: 0; }
main { max-width: 1080px; margin: 64px auto; padding: 0 24px; }
h1 { margin: 12px 0; font-size: clamp(28px, 5vw, 40px); letter-spacing: -.03em; }
p { line-height: 1.6; }
.status { display: inline-block; padding: 6px 12px; border-radius: 20px; background: #dcefe8; color: #17523c; font-size: 14px; font-weight: 600; }
.intro { color: #465d6c; margin-bottom: 32px; }
.reports { overflow-x: auto; border: 1px solid #d6dfe5; border-radius: 12px; background: white; }
table { width: 100%; border-collapse: collapse; text-align: left; }
caption { text-align: left; padding: 20px 24px; font-size: 18px; font-weight: 600; }
thead { background: #f8fafb; font-size: 13px; color: #465d6c; }
th, td { padding: 20px 24px; border-top: 1px solid #e3e9ed; }
tbody th { min-width: 290px; font-weight: 600; }
td { min-width: 140px; font-variant-numeric: tabular-nums; }
a { color: #086b68; text-underline-offset: 4px; }
.primary { display: inline-block; padding: 10px 18px; border-radius: 8px; background: #086b68; color: white; font-weight: 600; text-decoration: none; }
.primary:hover { background: #124340; color: white; }
a:hover { color: #124340; }
a:focus-visible { outline: 3px solid #086b68; outline-offset: 4px; }
small { display: block; margin-top: 8px; font-size: 13px; line-height: 1.5; color: #465d6c; font-weight: 400; }
strong { font-size: 21px; }
.track { height: 6px; margin-top: 12px; background: #e6eeed; border-radius: 4px; overflow: hidden; }
.track span { display: block; height: 100%; background: #168078; }
.note { margin: 24px 0; color: #465d6c; font-size: 14px; }
footer { border-top: 1px solid #d6dfe5; padding-top: 12px; font-size: 13px; color: #465d6c; }
code { overflow-wrap: anywhere; }
@media (max-width: 600px) { main { margin: 32px auto; padding: 0 16px; } th, td { padding: 16px; } }
</style>
</head>
<body>
<main>
<span class="status">${runner} passed · ${tests.totalPassed}/${tests.totalTests} tests</span>
${cli.totalTests ? `<span class="status">CLI passed · ${cli.totalPassed}/${cli.totalTests} tests</span>` : ''}
<h1>MageLens coverage report</h1>
<p class="intro">PHP, JavaScript, browser-template and XML configuration coverage from the same ${runner} run. Browse project files and module totals in the combined report.</p>
<p><a class="primary" href="combined/index.html">By directory</a></p>
<div class="reports">
<table>
<caption>Coverage overview</caption>
<thead><tr><th scope="col">Report</th><th scope="col">Covered / eligible lines</th><th scope="col">Uncovered lines</th><th scope="col">Coverage</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
<p class="note">The overall total counts physical lines once where PHP and template coverage overlap in PHTML. JavaScript lines use mapped statement starts. XML configuration effects have a separate total.</p>
${combined.overall.partial ? `<p class="note">Partial measurements in ${combined.overall.partial} files. See the directory report for affected paths and reasons.</p>` : ''}
<details class="note">
<summary>Collector reports and data</summary>
<p><a href="php/index.html">PHP lines</a> · <a href="js/index.html">JavaScript statements</a> · <a href="templates/index.html">Template execution</a></p>
<p>${presence}</p>
${javascriptDetails}
${templateDetails}
</details>
${templateWarning}
<div class="reports">
<table>
<caption>Reports</caption>
<thead><tr><th scope="col">Report</th><th scope="col">Audited</th><th scope="col">Findings</th></tr></thead>
<tbody>${htmlValidationRow}</tbody>
</table>
</div>
<p class="note">Reports list findings from checks that tests request explicitly. Findings do not change the test result.</p>
<footer>
<p>Run <code>${escapeHtml(run.id)}</code><br>Generated <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(generatedAt)}</time> · <a href="summary.json">Coverage data (JSON)</a></p>
</footer>
</main>
</body>
</html>
`);
}

module.exports = {writeIndex, templateLimitations, escapeHtml};
