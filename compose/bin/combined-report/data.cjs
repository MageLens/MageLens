// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path = require('node:path').posix;
const {isCoverageExcluded} = require('../project.cjs');

const types = {
    php: 'PHP executable lines',
    js: 'JavaScript mapped lines',
    template: 'Template executable lines'
};

function addCounts(target, counts) {
    target.covered += counts.covered;
    target.total += counts.total;
}

function lineCounts(lines) {
    return {covered: [...lines.values()].filter(Boolean).length, total: lines.size};
}

function markLine(lines, number, hit) {
    lines.set(number, lines.get(number) || Boolean(hit));
}

function counterCounts(hits) {
    return {covered: hits.filter(hit => hit > 0).length, total: hits.length};
}

function javascriptDimension(data, warnings) {
    const lines = new Map();
    const native = {};
    if (!data) {
        warnings.push('JavaScript measurement is missing.');
        return {lines, native};
    }

    let unmapped = 0;
    for (const [id, hits] of Object.entries(data.s)) {
        const line = data.statementMap[id]?.start?.line;
        if (Number.isSafeInteger(line) && line > 0) markLine(lines, line, hits);
        else unmapped++;
    }
    if (unmapped) warnings.push(`${unmapped} JavaScript statements have no original starting line.`);
    native['JavaScript statements'] = counterCounts(Object.values(data.s));
    native['JavaScript functions'] = counterCounts(Object.values(data.f));
    native['JavaScript branches'] = counterCounts(Object.values(data.b).flat());
    return {lines, native};
}

function templateDimension(entry, records, warnings) {
    const lines = new Map();
    const native = {};
    if (!entry) {
        warnings.push('Template measurement is missing.');
        return {lines, native};
    }
    for (const reason of [entry.executionUnsupported, ...(entry.unsupportedDirectives || []), ...(entry.measurementLimitations || [])]) {
        if (reason) warnings.push(reason);
    }
    for (const script of entry.scripts || []) {
        if (script.status === 'unsupported') warnings.push(script.reason || 'Unsupported inline script.');
        for (const fragment of script.generated || []) {
            if (['unresolved', 'unobserved'].includes(fragment.status)) {
                warnings.push(fragment.reason || 'PHP-generated script without a static source map.');
            }
        }
    }
    if (!entry.instrumented) warnings.push('Template instrumentation is unavailable.');
    else if (!records) warnings.push('Template inventory only. No observation records were collected.');
    else {
        for (const [line, counts] of Object.entries(entry.lineHits)) markLine(lines, Number(line), counts.hits);
        for (const metric of ['statements', 'functions', 'branches']) {
            native[`Template ${metric}`] = counterCounts(entry[metric].map(item => item.hits));
        }
        native['DOM presence'] = entry.status === 'observed' ? `Observed (${entry.observations})` : 'Unobserved';
    }
    return {lines, native};
}

function buildCoverage({run, php, javascript, scope, templates}) {
    const scripts = new Map(scope.included.map(entry => [entry.path, entry.coveragePath]));
    const templateEntries = new Map(templates.templates.map(entry => [entry.path, entry]));
    const excludedScripts = new Set((scope.excluded || []).map(entry => entry.path));
    const files = [];
    const totals = Object.fromEntries(Object.keys(types).map(type => [type, {covered: 0, total: 0}]));
    const directories = new Map([['', {path: '', covered: 0, total: 0, files: 0, partial: 0}]]);
    for (const source of Object.keys(run.sources).sort()) {
        const file = source.slice('src/'.length);
        const extension = path.extname(file).slice(1);
        if (!['php', 'phtml', 'js', 'html'].includes(extension) || isCoverageExcluded(file) || excludedScripts.has(file)) continue;

        const dimensions = {};
        const warnings = [];
        if (extension === 'php' || extension === 'phtml') {
            const measured = Object.hasOwn(php, file);
            if (!measured) warnings.push('PHP line measurement is missing.');
            dimensions.php = {lines: new Map(Object.entries(measured ? php[file] : {}).map(([line, hit]) => [Number(line), hit]))};
        }
        if (extension === 'js') {
            const key = scripts.get(file);
            dimensions.js = javascriptDimension(key && javascript[key], warnings);
        }
        // PHP-only PHTML is intentionally absent from the template inventory.
        if (extension === 'html' || templateEntries.has(file)) {
            dimensions.template = templateDimension(templateEntries.get(file), templates.records, warnings);
        }
        const lines = new Map();
        for (const [type, dimension] of Object.entries(dimensions)) {
            dimension.counts = lineCounts(dimension.lines);
            addCounts(totals[type], dimension.counts);
            for (const [line, hit] of dimension.lines) markLine(lines, line, hit);
        }
        const counts = lineCounts(lines);
        files.push({path: file, extension, dimensions, warnings, ...counts});
        let directory = file;
        do {
            const separator = directory.lastIndexOf('/');
            directory = separator < 0 ? '' : directory.slice(0, separator);
            if (!directories.has(directory)) directories.set(directory, {path: directory, covered: 0, total: 0, files: 0, partial: 0});
            const entry = directories.get(directory);
            addCounts(entry, counts);
            entry.files++;
            entry.partial += Number(warnings.length > 0);
        } while (directory);
    }
    return {files, directories, totals, overall: directories.get('')};
}

module.exports = {buildCoverage, types};
