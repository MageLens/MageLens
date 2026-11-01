// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const digest = value => createHash('sha256').update(value.replace(/\r\n?/g, '\n')).digest('hex');
const sort = values => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
const read = (directory, file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
const object = value => { assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Missing coverage map'); return value; };
const array = value => { assert.ok(Array.isArray(value), 'Missing coverage inventory'); return value; };
const count = value => { assert.ok(Number.isSafeInteger(value) && value >= 0, 'Invalid coverage count'); return value; };
const hit = value => count(value) > 0;
// Istanbul uses empty positions for an implicit else path with no source span.
const position = value => { object(value); return [value.line === undefined ? null : count(value.line), value.column === undefined ? null : count(value.column)]; };
const location = value => [position(value?.start), position(value?.end)];
// Hash arbitrary strings, including private package names, expressions and warnings.
// Only repository/public fixture paths are retained for useful CI diagnostics.
function fileKey(file) {
    const match = String(file).replace(/\\/g, '/').match(/(?:^|\/)((?:app\/code|app\/design|vendor|lib\/web)\/[^\0]+)$/);
    assert.ok(match && !match[1].split('/').includes('..'), 'Unrecognized coverage source root');
    const relative = match[1];
    return /^(?:app\/code\/(?:Application\/Blog|MageLens\/CoverageProbe)\/|vendor\/hyva-themes\/)/.test(relative)
        ? relative : `source-sha256:${digest(relative)}`;
}
function files(entries, project) {
    const result = {};
    for (const [file, value] of entries) {
        const key = fileKey(file);
        assert.ok(!(key in result), 'Duplicate normalized coverage source');
        result[key] = project(value);
    }
    return result;
}
function counters(counts, maps, project) {
    assert.deepEqual(Object.keys(object(counts)).sort(), Object.keys(object(maps)).sort(), 'Incomplete counter map');
    return sort(Object.entries(counts).map(([id, value]) => project(maps[id], value)));
}
function totals(value) {
    object(value);
    return Object.fromEntries(Object.entries(value).map(([key, number]) => {
        assert.ok(['total', 'covered', 'uncovered', 'skipped', 'pct', 'percent', 'eligible', 'unsupported'].includes(key), 'Unknown coverage total');
        assert.ok(number === null || Number.isFinite(number), 'Invalid coverage total');
        return [key, number];
    }));
}
const istanbulTotals = value => Object.fromEntries(['lines', 'statements', 'functions', 'branches'].map(key => [key, totals(value[key])]));
function templateCounter(value) {
    return [location(value), digest(value.syntax || value.type || ''), Boolean(value.implicit), hit(value.hits)];
}
function template(value) {
    assert.equal(typeof value.source, 'string', 'Missing template source fingerprint');
    assert.equal(typeof value.instrumented, 'boolean');
    assert.ok(['observed', 'unobserved', 'unsupported'].includes(value.status));
    return {
        source: digest(value.source), kind: digest(value.kind), engine: digest(value.engine),
        engines: sort(array(value.engines).map(digest)), instrumented: value.instrumented, status: value.status,
        warnings: sort(array(value.unsupportedDirectives || []).map(digest)), executionUnsupported: digest(value.executionUnsupported || ''),
        statements: sort(array(value.statements).map(templateCounter)),
        functions: sort(array(value.functions).map(templateCounter)),
        branches: sort(array(value.branches).map(templateCounter)),
        lines: Object.fromEntries(Object.entries(object(value.lineHits)).map(([line, data]) =>
            [line, [hit(data.hits), count(data.statements), count(data.covered)]])),
        totals: Object.fromEntries(['lineSummary', 'statementSummary', 'functionSummary', 'branchSummary'].map(key => [key, totals(value[key])])),
        scripts: sort(array(value.scripts).map(script => ({line: count(script.line), status: digest(script.status), reason: digest(script.reason || ''),
            generated: sort((script.generated || []).map(fragment => ({line: count(fragment.line), tracked: Boolean(fragment.tracked),
                status: digest(fragment.status), reason: digest(fragment.reason || ''), emptyObserved: Boolean(fragment.emptyObserved),
                targets: sort(array(fragment.targets).map(target => fileKey(target.path)))})))})))
    };
}
function snapshot(directory) {
    const run = read(directory, 'run.json');
    const php = read(directory, 'php/coverage-summary.json');
    const js = read(directory, 'javascript-summary.json');
    const templates = read(directory, 'templates/coverage-summary.json');
    const summary = read(directory, 'summary.json');
    for (const report of [php, js, summary]) assert.equal(report.run, run.id, 'Stale coverage summary');
    assert.equal(templates.schemaVersion, 2);
    const result = {
        schema: 1, run: run.id,
        metrics: Object.fromEntries(['php', 'js', 'templates'].map(key => [key, summary.metrics[key].percent])),
        php: {totals: totals({total: php.total, covered: php.covered, percent: php.percent}),
            files: files(Object.entries(read(directory, 'php/line-coverage.json')), lines =>
                Object.fromEntries(Object.entries(object(lines)).map(([line, value]) => [line, hit(value)])))},
        js: {groups: Object.fromEntries(['all', 'application', 'libraries'].map(group => [group, istanbulTotals(js.groups[group])])),
            excluded: sort(array(js.excluded).map(entry => [fileKey(entry.path), digest(entry.reason)])),
            files: files(Object.entries(read(directory, 'js/coverage-final.json')), value => ({
                statements: counters(value.s, value.statementMap, (loc, hits) => [location(loc), hit(hits)]),
                functions: counters(value.f, value.fnMap, (fn, hits) => [location(fn.loc), location(fn.decl), hit(hits)]),
                branches: counters(value.b, value.branchMap, (branch, hits) => {
                    assert.equal(array(hits).length, array(branch.locations).length, 'Incomplete branch paths');
                    return [digest(branch.type), location(branch.loc), hits.map((hits, index) => [location(branch.locations[index]), hit(hits)])];
                })
            }))},
        templates: {totals: Object.fromEntries(['summary', 'lines', 'statements', 'functions', 'branches'].map(key => [key, totals(templates[key])])),
            files: files(array(templates.templates).map(entry => [entry.path, entry]), template)}
    };
    validateSnapshot(result, run.id, summary);
    return result;
}
function validateSnapshot(value, run, summary) {
    assert.equal(value.schema, 1, 'Missing complete coverage snapshot');
    assert.equal(value.run, run, 'Stale complete coverage snapshot');
    for (const type of ['php', 'js', 'templates']) {
        assert.ok(Object.keys(object(value[type]?.files)).length, `Empty ${type} inventory`);
        assert.equal(value.metrics[type], summary.metrics[type].percent, `Mismatched ${type} summary`);
    }
    totals(value.php.totals);
    for (const lines of Object.values(value.php.files)) for (const [line, covered] of Object.entries(object(lines))) {
        assert.match(line, /^[1-9]\d*$/, 'Invalid PHP line');
        assert.equal(typeof covered, 'boolean');
    }
    for (const group of ['all', 'application', 'libraries']) istanbulTotals(value.js.groups[group]);
    array(value.js.excluded);
    for (const file of Object.values(value.js.files)) for (const key of ['statements', 'functions', 'branches']) array(file[key]);
    for (const key of ['summary', 'lines', 'statements', 'functions', 'branches']) totals(value.templates.totals[key]);
    for (const file of Object.values(value.templates.files)) {
        for (const key of ['source', 'kind', 'engine', 'executionUnsupported']) assert.match(file[key], /^[a-f0-9]{64}$/, 'Missing source or measurement fingerprint');
        for (const key of ['engines', 'warnings', 'statements', 'functions', 'branches', 'scripts']) array(file[key]);
        object(file.lines);
        assert.equal(typeof file.instrumented, 'boolean');
        assert.ok(['observed', 'unobserved', 'unsupported'].includes(file.status));
        for (const key of ['lineSummary', 'statementSummary', 'functionSummary', 'branchSummary']) totals(file.totals[key]);
    }
}
function compareThemes(reports, expected) {
    const errors = [];
    const expectedIds = expected.map(entry => entry.id).sort();
    if (!isDeepStrictEqual(reports.map(report => report.id).sort(), expectedIds)) errors.push('Missing, unexpected or duplicate matrix reports');
    const themes = {};
    for (const theme of ['luma', 'hyva']) {
        const entries = reports.filter(report => report.theme === theme);
        const required = expected.filter(entry => entry.theme === theme);
        const differences = [];
        const baseline = entries[0];
        for (const report of entries.slice(1)) {
            for (const section of ['metrics', 'php', 'js', 'templates']) {
                const left = baseline.snapshot[section], right = report.snapshot[section];
                if (isDeepStrictEqual(left, right)) continue;
                if (section === 'metrics') differences.push({case: report.id, section});
                else {
                    if (!isDeepStrictEqual({...left, files: null}, {...right, files: null})) differences.push({case: report.id, section, totals: true});
                    for (const file of [...new Set([...Object.keys(left.files), ...Object.keys(right.files)])].sort()) {
                        if (!isDeepStrictEqual(left.files[file], right.files[file])) differences.push({case: report.id, section, file,
                            ...details(left.files[file], right.files[file])});
                    }
                }
            }
        }
        themes[theme] = {baseline: baseline?.id, expectedCases: required.length, completedCases: entries.length, differences};
        if (entries.length !== required.length || differences.length) errors.push(`${theme}: ${entries.length}/${required.length} reports, ${differences.length} coverage differences`);
    }
    return {passed: errors.length === 0, errors, themes};
}
function details(left, right) {
    let total = 0;
    const changes = [];
    function visit(a, b, at) {
        if (isDeepStrictEqual(a, b)) return;
        if (a && b && typeof a === 'object' && typeof b === 'object') {
            for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) visit(a[key], b[key], `${at}/${key}`);
        } else {
            total++;
            // Bound diagnostics, never the comparison. Missing sources are identified
            // without copying their entire counter maps into every mismatch report.
            if (changes.length < 100) changes.push({at, expected: typeof a === 'object' ? '<inventory>' : a ?? null,
                actual: typeof b === 'object' ? '<inventory>' : b ?? null});
        }
    }
    visit(left, right, '');
    return {totalDifferences: total, changes};
}
module.exports = {snapshot, validateSnapshot, compareThemes};
