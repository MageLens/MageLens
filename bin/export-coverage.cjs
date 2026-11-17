// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {escapeHtml} = require('./report-index.cjs');
const {shareReportData} = require('./share-report-data.cjs');
const {createSourceReader} = require('./share-report-source.cjs');

function percentage(covered, total) {
    return total ? (covered * 100 / total).toFixed(2) + '%' : 'N/A';
}

function writeReport(fd, sections, readSource) {
    const write = value => fs.writeFileSync(fd, value);
    const sourceLinks = new Map();
    write(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>MageLens coverage report</title>
<style>
:root{color-scheme:light dark;font:1rem/1.55 system-ui,sans-serif}body{max-width:74rem;margin:2rem auto;padding:0 1rem}
h1{margin-bottom:0}h2,summary{font-size:1.25rem}table{width:100%;border-collapse:collapse;margin:1rem 0}
th,td{padding:.45rem;text-align:right;border-bottom:1px solid #8886;font-variant-numeric:tabular-nums}
th:first-child,td:first-child{text-align:left;overflow-wrap:anywhere}th[scope=row]{font-weight:normal}
details{margin:1.25rem 0}summary{cursor:pointer}pre{overflow:auto;padding:.75rem;border:1px solid #8886}
</style></head><body><main><h1>MageLens coverage report</h1>
<p>${readSource ? 'Includes original source for the measured files.' : 'Includes coverage metrics and project-relative file paths.'} N/A means there are no measurable items.</p>
<table><caption>Coverage overview</caption><thead><tr><th>Metric</th><th>Covered</th><th>Total</th><th>Coverage</th></tr></thead><tbody>`);
    for (const section of sections) {
        write(`<tr><th scope="row">${escapeHtml(section.label)}</th><td>${section.covered}</td><td>${section.total}</td><td>${percentage(section.covered, section.total)}</td></tr>`);
    }
    write('</tbody></table>');
    for (const section of sections) {
        write(`<details><summary>${escapeHtml(section.label)} (${section.files.length} files)</summary>`);
        if (section.warningCount) write(`<p>Measurement warnings: ${section.warningCount}. Coverage counts only measurable items.</p>`);
        write('<table><thead><tr><th>File</th><th>Covered</th><th>Total</th><th>Coverage</th></tr></thead><tbody>');
        for (const file of section.files) {
            let label = escapeHtml(file.path);
            if (readSource) {
                if (!sourceLinks.has(file.path)) sourceLinks.set(file.path, 'source-' + sourceLinks.size);
                label = `<a href="#${sourceLinks.get(file.path)}">${label}</a>`;
            }
            write(`<tr><th scope="row">${label}</th><td>${file.covered}</td><td>${file.total}</td><td>${percentage(file.covered, file.total)}</td></tr>`);
        }
        write('</tbody></table></details>');
    }
    if (readSource) {
        write('<h2>Original source</h2>');
        for (const [file, id] of sourceLinks) {
            write(`<details id="${id}"><summary>${escapeHtml(file)}</summary><pre><code>${escapeHtml(readSource(file))}</code></pre></details>`);
        }
    }
    write('</main></body></html>\n');
}

function exportReport(includeSource) {
    const name = includeSource ? 'share-with-source.html' : 'share.html';
    const directory = path.join(fs.realpathSync('.'), 'coverage');
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('Expected a local coverage directory.');
    fs.mkdirSync('.runtime', {recursive: true});
    const lock = '.runtime/workflow.lock';
    try {
        fs.mkdirSync(lock);
    } catch (error) {
        if (error.code === 'EEXIST') throw new Error('Another MageLens workflow is active. Retry after it completes.');
        throw error;
    }
    try {
        if (fs.lstatSync(path.join(directory, '.active-run'), {throwIfNoEntry: false}) ||
            !fs.lstatSync(path.join(directory, 'index.html'), {throwIfNoEntry: false})?.isFile()) {
            throw new Error('Run ./bin/run-coverage successfully before exporting.');
        }
        const sections = shareReportData(directory);
        const readSource = includeSource ? createSourceReader('.', directory) : null;
        const temporary = path.join(directory, '.share-' + randomUUID() + '.tmp');
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try {
            try {
                writeReport(fd, sections, readSource);
            } finally {
                fs.closeSync(fd);
            }
            fs.renameSync(temporary, path.join(directory, name));
        } finally {
            fs.rmSync(temporary, {force: true});
        }
    } finally {
        fs.rmdirSync(lock);
    }
    console.log('Share this file: coverage/' + name);
}

try {
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 1 && args[0] === '--include-source')) {
        throw new Error('Usage: ./bin/export-coverage [--include-source]');
    }
    exportReport(args.length === 1);
} catch (error) {
    console.error('Cannot export coverage:', error.message);
    process.exitCode = 1;
}
