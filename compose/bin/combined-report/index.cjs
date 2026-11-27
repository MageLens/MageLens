// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {escapeHtml: html} = require('../report-index.cjs');
const {formatPercent, coverageColor} = require('../badges.cjs');
const {createSourceReader} = require('../share-report-source.cjs');
const {types} = require('./data.cjs');
const homeIcon = `<svg class="home-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="m3 10 9-7 9 7 M5 9v11h14V9 M9 20v-7h6v7"/>
</svg>`;

function percentage({covered, total}) {
    return formatPercent(total ? covered / total * 100 : null);
}

function page(title, content, parentDirectory) {
    const fromSource = parentDirectory !== undefined;
    const backHref = fromSource ? `index.html#${encodeURIComponent(parentDirectory)}` : '../index.html';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(title)} | MageLens</title>
<link rel="stylesheet" href="report.css">
</head>
<body>
<main>
<nav class="report-navigation" aria-label="Report navigation">
<a id="report-back" class="back-link" href="${backHref}"><span id="back-icon" aria-hidden="true"${fromSource ? '' : ' hidden'}>←</span><span id="back-home"${fromSource ? ' hidden' : ''}>${homeIcon}</span> <span id="back-label">${fromSource ? 'Back to directory' : 'Back to overview'}</span></a>
<a id="report-overview" class="overview-link" href="../index.html"${fromSource ? '' : ' hidden'}>${homeIcon} Coverage overview</a>
</nav>
<h1>${html(title)}</h1>
${content}
</main>
</body>
</html>
`;
}

function sourceView(file, source) {
    const parts = file.path.split('/');
    const parent = parts.slice(0, -1);
    const breadcrumbs = parent.map((part, index) =>
        `<a href="index.html#${encodeURIComponent(parts.slice(0, index + 1).join('/'))}">${html(part)}</a>`);
    const dimensions = Object.entries(file.dimensions);
    const metrics = dimensions.flatMap(([type, detail]) => [[types[type], detail.counts], ...Object.entries(detail.native || {})]);
    const rows = metrics.map(([label, value]) => `<tr><th scope="row">${html(label)}</th><td>${
        typeof value === 'string' ? html(value) : `${value.covered} / ${value.total} (${percentage(value)})`
    }</td></tr>`).join('\n');
    const warnings = file.warnings.length ? `<ul class="warnings">${file.warnings.map(reason => `<li>${html(reason)}</li>`).join('')}</ul>` : '';
    const states = ['Uncovered', 'Covered'];
    const lines = source.split(/\r\n|\r|\n/).map((line, index) => {
        const number = index + 1;
        const cells = dimensions.map(([, {lines}]) => {
            if (!lines.has(number)) return '<td class="state" aria-label="Outside measured lines">—</td>';
            const state = states[Number(Boolean(lines.get(number)))];
            return `<td class="state ${state.toLowerCase()}">${state}</td>`;
        }).join('');
        return `<tr id="L${number}"><th scope="row"><a href="#L${number}">${number}</a></th>${cells}<td><pre>${html(line)}</pre></td></tr>`;
    }).join('\n');
    return page(parts.at(-1), `<nav aria-label="Breadcrumb"><a href="index.html">Project root</a> / ${breadcrumbs.join(' / ')} / <span aria-current="page">${html(parts.at(-1))}</span></nav>
<p><strong>Overall line coverage</strong> ${file.covered} / ${file.total} (${percentage(file)})</p>
${warnings}
<div class="table"><table><caption>Coverage dimensions</caption><tbody>${rows}</tbody></table></div>
<div class="table source"><table><caption>Original source</caption>
<thead><tr><th>Line</th>${dimensions.map(([type]) => `<th>${types[type]}</th>`).join('')}<th>Source</th></tr></thead>
<tbody>${lines}</tbody></table></div>`, parent.join('/'));
}

function writeCombinedReport(coverage, directory = 'coverage') {
    const output = path.join(directory, 'combined');
    const readSource = createSourceReader(process.cwd(), directory);
    fs.mkdirSync(output, {recursive: true});
    const files = coverage.files.map((file, index) => {
        const href = `source-${index + 1}.html`;
        fs.writeFileSync(path.join(output, href), sourceView(file, readSource(file.path)));
        const {path: relative, extension, covered, total, warnings} = file;
        return {path: relative, extension, covered, total, partial: Number(warnings.length > 0), href};
    });
    const withColor = entry => ({...entry, color: coverageColor(entry.total ? entry.covered / entry.total * 100 : null)});
    const data = JSON.stringify({
        directories: [...coverage.directories.values()].map(withColor),
        files: files.map(withColor)
    }).replaceAll('<', '\\u003c');
    fs.writeFileSync(path.join(output, 'index.html'), page('Coverage by directory', `<nav aria-label="Breadcrumb" id="breadcrumb"></nav>
<p id="summary" role="status"></p>
<div class="controls">
<label>Search paths <input id="query" type="search"></label>
<label>Sort by <select id="sort">
<option value="path">Name (A–Z)</option>
<option value="ascending">Coverage (low to high)</option>
<option value="descending">Coverage (high to low)</option>
</select></label>
</div>
<div class="table"><table aria-label="Directory coverage">
<thead><tr><th scope="col">Name</th><th scope="col">Covered / eligible lines</th><th scope="col">Coverage</th><th scope="col">Measurement</th></tr></thead>
<tbody id="entries"></tbody>
</table></div>
<noscript>Enable JavaScript to browse directories and search paths.</noscript>
<details>
<summary>How line coverage is calculated</summary>
<p>PHP uses executable lines. JavaScript uses the original starting lines of mapped statements. Templates use the starting lines of mapped bindings, expressions and inline script statements. Any hit on an eligible line covers it.</p>
<p>PHP and template coverage on the same PHTML line count once in the overall result. A hit from either collector covers that line. Directory totals sum the covered and eligible lines of distinct descendant files. XML configuration effects, DOM presence, functions and branches have separate metrics.</p>
<p>Coverage is covered lines divided by eligible lines. N/A means no measured eligible lines. Partial results have missing or limited measurements.</p>
</details>
<script type="application/json" id="coverage-data">${data}</script>
<script src="tree.js" defer></script>`));
    for (const asset of ['tree.js', 'report.css']) fs.copyFileSync(path.join(__dirname, asset), path.join(output, asset));
}

module.exports = {writeCombinedReport};
