// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {isShareablePath} = require('./share-report-source.cjs');

function counts({covered, total}) {
    if (!Number.isSafeInteger(covered) || !Number.isSafeInteger(total) || covered < 0 || covered > total) {
        throw new Error('Invalid coverage counts in the completed report.');
    }
    return {covered, total};
}

function warningCount(warnings = []) {
    if (!Array.isArray(warnings)) throw new Error('Invalid measurement warnings in the completed report.');
    return warnings.length;
}

function section(label, totals, files) {
    const {covered, total} = counts(totals);
    if (new Set(files.map(file => file.path)).size !== files.length ||
        files.reduce((sum, file) => sum + file.covered, 0) !== covered ||
        files.reduce((sum, file) => sum + file.total, 0) !== total) {
        throw new Error(`File coverage does not match the ${label} report.`);
    }
    return {label, covered, total, files: files.sort((left, right) => left.path.localeCompare(right.path))};
}

function shareReportData(coverageDir) {
    const directory = fs.realpathSync(coverageDir);
    function read(name) {
        const file = path.join(directory, name);
        if (fs.realpathSync(file) !== file || !fs.statSync(file).isFile()) {
            throw new Error('Expected a regular coverage report file.');
        }
        const content = fs.readFileSync(file, 'utf8');
        try {
            return JSON.parse(content);
        } catch {
            throw new Error(`Invalid JSON in ${name}.`);
        }
    }

    const run = read('run.json');
    const summary = read('summary.json');
    const php = read('php/coverage-summary.json');
    const javascript = read('js/coverage-summary.json');
    const scope = read('javascript-scope.json');
    const templates = read('templates/coverage-summary.json');
    if (!run.id || summary.run !== run.id || php.run !== run.id || scope.run !== run.id) {
        throw new Error('Coverage reports belong to different runs.');
    }

    function row(file, extension, values) {
        if (!isShareablePath(file) || !extension.test(file) || !Object.hasOwn(run.sources, 'src/' + file)) {
            throw new Error('Coverage contains a path outside the measured source inventory.');
        }
        return {path: file, ...counts(values)};
    }

    const phpFiles = Object.entries(read('php/line-coverage.json')).map(([file, lines]) => {
        const hits = Object.values(lines);
        if (!hits.every(hit => hit === 0 || hit === 1)) throw new Error('Invalid PHP line coverage.');
        return row(file, /\.(php|phtml)$/, {covered: hits.filter(hit => hit === 1).length, total: hits.length});
    });
    // Istanbul keys are absolute container paths. Only the inventoried relative paths may leave the workspace.
    const jsFiles = scope.included.map(({path: file, coveragePath}) => {
        if (typeof coveragePath !== 'string' || !coveragePath.endsWith('/src/' + file) || !Object.hasOwn(javascript, coveragePath)) {
            throw new Error('A measured JavaScript file is missing from the report.');
        }
        return row(file, /\.js$/, javascript[coveragePath].statements);
    });
    if (Object.keys(javascript).length !== jsFiles.length + 1) throw new Error('Unexpected JavaScript coverage inventory.');
    const templateFiles = templates.templates.map(entry => row(entry.path, /\.(html|phtml)$/, entry.lineSummary));
    const sections = [
        section('PHP lines', php, phpFiles),
        section('JavaScript statements', javascript.total.statements, jsFiles),
        {...section('Template executable lines', templates.lines, templateFiles),
            warningCount: templates.templates.reduce((sum, entry) => sum + warningCount(entry.unsupportedDirectives), 0)
                + warningCount(templates.scripts?.unsupported) + warningCount(templates.scripts?.generated)}
    ];
    if (Object.hasOwn(summary.metrics, 'xml')) {
        const xml = read('xml/coverage.json');
        if (xml.run !== run.id || xml.complete !== true) throw new Error('Incomplete or stale XML coverage.');
        const xmlFiles = xml.files.map(entry => row(entry.path, /\.xml$/, entry));
        sections.push({...section('XML configuration lines', xml, xmlFiles), warningCount: warningCount(xml.warnings)});
    }
    return sections;
}

module.exports = {shareReportData};
