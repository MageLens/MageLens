// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');

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

function writeIndex({run, generatedAt, metrics, php, js, templates, tests}) {
    const runner = run.runner === 'playwright' ? 'Playwright' : 'Cypress';
    const reports = [
        {key: 'php', covered: php.covered, total: php.total, unit: 'lines',
            description: 'Executable PHP in .php and .phtml files; original source, without HTML or JavaScript lines.'},
        {key: 'js', covered: js.total.statements.covered, total: js.total.statements.total, unit: 'statements',
            description: 'Whole .js files executed in the browser.'},
        {key: 'templates', covered: templates.lines.covered, total: templates.lines.total, unit: 'template lines',
            description: `HTML/PHTML bindings and inline script execution. DOM presence: ${templates.summary.covered}/${templates.summary.eligible} templates (${templates.summary.percent}%).`}
    ];
    const rows = reports.map(report => {
        const metric = metrics[report.key];
        const percent = metric.percent.toFixed(2);
        return `<tr>
<th scope="row"><a href="${report.key}/index.html">${escapeHtml(metric.label)} <span aria-hidden="true">↗</span></a><small>${report.description}</small></th>
<td>${report.covered} / ${report.total}<small>${report.unit} covered</small></td>
<td>${report.total - report.covered}<small>${report.unit} uncovered</small></td>
<td><strong>${percent}%</strong><div class="track" aria-hidden="true"><span style="width:${percent}%"></span></div></td>
</tr>`;
    }).join('\n');
    const javascript = fs.existsSync('coverage/javascript-summary.json') ? JSON.parse(fs.readFileSync('coverage/javascript-summary.json')) : null;
    const javascriptDetails = javascript ? `<p class="note">JavaScript reports: <a href="js-application/index.html">application</a> · <a href="js-libraries/index.html">bundled libraries</a>. <a href="javascript-summary.json">Group totals</a> · <a href="javascript-scope.json">Scope and exclusion reasons</a>.</p>` : '';
    const templateDetails = templates.scripts ? `<p class="note">Template scripts: ${templates.scripts.instrumented} instrumented; ${templates.scripts.unsupported.length} unsupported; ${templates.scripts.generated.length} PHP-generated fragments without a static map. <a href="templates/index.html">Template report</a> · <a href="templates/coverage-summary.json">Template coverage details</a>.</p>` : '';
    const gaps = templateLimitations(templates);
    const templateWarning = Object.values(gaps).some(items => items.length) ? `<p class="note"><strong>Template measurement is partial.</strong> ${gaps.directives.length} unsupported directives, ${gaps.scripts.length} unsupported scripts and ${gaps.generated.length} unmapped PHP outputs are not fully measured. The percentage covers instrumented constructs only. <a href="templates/coverage-summary.json">Inspect the affected files and reasons</a>.</p>` : '';
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
<h1>MageLens coverage report</h1>
<p class="intro">PHP, JavaScript and browser-template coverage from the same ${runner} run. Open a report to inspect individual files.</p>
<div class="reports">
<table>
<caption>Coverage overview</caption>
<thead><tr><th scope="col">Report</th><th scope="col">Covered</th><th scope="col">Uncovered</th><th scope="col">Coverage</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
<p class="note">PHP measures executable lines; JavaScript measures statements so minified bundles do not distort the percentage. Template coverage measures bindings, template expressions and inline scripts in HTML/PHTML, mapped to their original source. Script functions, branches and DOM presence are reported separately. Unvisited eligible code remains in the denominator.</p>
${javascriptDetails}
${templateDetails}
${templateWarning}
<footer>
<p>Run <code>${escapeHtml(run.id)}</code><br>Generated <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(generatedAt)}</time> · <a href="summary.json">Coverage data (JSON)</a></p>
</footer>
</main>
</body>
</html>
`);
}

module.exports = {writeIndex, templateLimitations};
