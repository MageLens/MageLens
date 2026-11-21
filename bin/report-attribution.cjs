// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Writes coverage/attribution/ from the test attempt records of a finished run
// (docs/coverage.md#per-test-attribution). Every attributed unit is checked against the
// aggregate reports, so attribution can never claim execution that the reports do not show.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {isCoverageExcluded} = require('./project.cjs');
const {mergeCounters} = require('./javascript-attempts.cjs');
const {projectPath} = require('./test-attempts.cjs');
const {countsAsFamilyCoverage} = require('./xml-family-report.cjs');
const {countsAsLayoutCoverage} = require('./xml-report/layout/index.cjs');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const files = (directory, extension) => fs.existsSync(directory)
    ? fs.readdirSync(directory).filter(file => file.endsWith(extension)).sort() : [];
const unattributed = 'unattributed';

// {file: {unit: {attempt index or 'unattributed': hits}}}, with files and units in a stable order.
function units() {
    const map = new Map();
    return {
        add(file, unit, owner, hits) {
            if (!(hits > 0)) return;
            const byUnit = map.get(file) || map.set(file, new Map()).get(file);
            const owners = byUnit.get(unit) || byUnit.set(unit, {}).get(unit);
            owners[owner] = (owners[owner] || 0) + hits;
        },
        toJSON: () => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([file, byUnit]) =>
            [file, Object.fromEntries([...byUnit].sort(([a], [b]) => a.localeCompare(b, 'en', {numeric: true})))])),
        count(owner) {
            let total = 0;
            for (const byUnit of map.values()) for (const owners of byUnit.values()) if (owner(owners)) total++;
            return total;
        }
    };
}

const byAnAttempt = owners => Object.keys(owners).some(owner => owner !== unattributed);
const unattributedOnly = owners => Object.keys(owners).every(owner => owner === unattributed);

function php(index, attempts) {
    const covered = read('coverage/php/line-coverage.json');
    const {tests: ids, lines} = read('coverage/php/attribution.json');
    const result = units();
    for (const [file, byLine] of Object.entries(lines)) {
        for (const [line, tests] of Object.entries(byLine)) {
            assert.equal(covered[file]?.[line], 1, `PHP attribution outside the report: ${file}:${line}`);
            for (const test of tests.map(test => ids[test])) {
                // Every attempt ID in a PHP record comes from an attempt record of this run.
                assert.ok(test === unattributed || index.has(test), `PHP attribution to an unknown attempt: ${file}:${line}`);
                result.add(file, line, index.get(test) ?? unattributed, 1);
            }
        }
    }
    for (const [file, byLine] of Object.entries(covered)) {
        for (const [line, hit] of Object.entries(byLine)) assert.ok(!hit || lines[file]?.[line], `Covered PHP line without attribution: ${file}:${line}`);
    }
    // A request that starts after its attempt finished, for example a late beacon, keeps that attempt.
    const summary = read('coverage/php/coverage-summary.json');
    const records = [...summary.requests, ...summary.commands];
    const late = records.filter(record => {
        const attempt = attempts[index.get(record.attempt)];
        return attempt && Date.parse(record.startedAt) > Date.parse(attempt.finishedAt);
    }).length;
    return {result, stats: {unit: 'line', records: records.length, unattributedRecords: records.filter(record => !index.has(record.attempt)).length,
        lateRecords: late}};
}

function javascript(index) {
    const source = path.resolve('src');
    const aggregate = read('.nyc_output/out.json');
    const attributed = {};
    const result = units();
    for (const file of files('coverage/raw/javascript-attempts', '.json')) {
        const owner = index.get(path.basename(file, '.json'));
        assert.notEqual(owner, undefined, `JavaScript counters of an unknown attempt: ${file}`);
        for (const [script, hit] of Object.entries(read(`coverage/raw/javascript-attempts/${file}`))) {
            if (isCoverageExcluded(script)) continue;
            assert.ok(aggregate[script], `Attributed JavaScript outside the aggregate: ${script}`);
            const relative = path.relative(source, script);
            for (const type of ['s', 'f']) for (const [id, hits] of Object.entries(hit[type] || {})) result.add(relative, `${type}:${id}`, owner, hits);
            for (const [id, hits] of Object.entries(hit.b || {})) hits.forEach((count, path) => result.add(relative, `b:${id}:${path}`, owner, count));
            mergeCounters(attributed, {[script]: hit});
        }
    }
    // Pages without an attempt, such as shared setup, add to the aggregate only.
    for (const [script, {s, f, b}] of Object.entries(aggregate)) {
        const relative = path.relative(source, script);
        const add = (unit, total, done) => {
            assert.ok(done <= total, `Attributed JavaScript exceeds the aggregate: ${script} ${unit}`);
            result.add(relative, unit, unattributed, total - done);
        };
        const own = attributed[script] || {};
        for (const type of ['s', 'f']) for (const [id, total] of Object.entries(type === 's' ? s : f)) add(`${type}:${id}`, total, own[type]?.[id] || 0);
        for (const [id, totals] of Object.entries(b)) totals.forEach((total, path) => add(`b:${id}:${path}`, total, own.b?.[id]?.[path] || 0));
    }
    return {result, stats: {unit: 'statement (s), function (f) and branch path (b) counters'}};
}

function templates(attempts, index) {
    const summary = read('coverage/templates/coverage-summary.json');
    const entries = new Map(summary.templates.map(entry => [entry.id, entry]));
    // Template records identify their test, not the attempt; retries and projects tell attempts apart.
    const key = ({spec, test, retry, project}) => JSON.stringify([spec, test, retry, project || null]);
    const owners = new Map();
    attempts.forEach((attempt, index) => owners.set(key(attempt), [...owners.get(key(attempt)) || [], index]));
    const result = units();
    const stats = {unit: 'template statement, function and branch counters', records: 0, unattributedRecords: 0, ambiguousRecords: 0};
    for (const file of files('coverage/raw/templates', '.mtc')) {
        const record = read(`coverage/raw/templates/${file}`);
        // Playwright stores the absolute spec path and starts the title path with the spec file.
        const spec = projectPath(record.spec);
        // Its title path starts with the file relative to the Playwright testDir, not to the project.
        const first = String(record.test[0]).split('\\').join('/');
        const test = spec === first || spec.endsWith(`/${first}`) ? record.test.slice(1) : record.test;
        const identity = owners.get(key({spec, test, retry: record.retry, project: record.project})) || [];
        // Records that carry their attempt ID need no matching by test identity, but must not contradict it.
        if (record.attempt) {
            assert.ok(index.has(record.attempt), `Template record of an unknown attempt: ${file}`);
            assert.ok(identity.includes(index.get(record.attempt)), `Template record of another test's attempt: ${file}`);
        }
        const matches = record.attempt ? [index.get(record.attempt)] : identity;
        const owner = matches.length === 1 ? matches[0] : unattributed;
        stats.records++;
        if (owner === unattributed) stats.unattributedRecords++;
        if (matches.length > 1) stats.ambiguousRecords++;
        for (const [id, counters] of Object.entries(record.hits)) {
            for (const [unit, hits] of Object.entries(counters)) result.add(entries.get(id).path, unit, owner, hits);
        }
    }
    const json = result.toJSON();
    for (const entry of summary.templates) {
        for (const item of [...entry.statements, ...entry.functions, ...entry.branches]) {
            const total = Object.values(json[entry.path]?.[item.id] || {}).reduce((sum, hits) => sum + hits, 0);
            assert.equal(total, item.hits, `Template attribution differs from the report: ${entry.path} ${item.id}`);
        }
    }
    return {result, stats};
}

function xml(index, run) {
    const report = read('coverage/xml/coverage.json');
    // The XML report names each request after its PHP record: the record file for HTTP, the command ID for CLI.
    const owners = new Map();
    for (const file of files(`coverage/raw/php/${run}`, '.json')) {
        const record = read(`coverage/raw/php/${run}/${file}`);
        const attempt = record.attempt ?? null;
        assert.ok(attempt === null || index.has(attempt), `XML record of an unknown attempt: ${file}`);
        owners.set(record.commandId ?? path.basename(file, '.json'), attempt === null ? unattributed : index.get(attempt));
    }
    const declarations = new Map(report.files.flatMap(file => file.declarations.map(item => [item.id, {file: file.path, item}])));
    const result = units();
    const totals = new Map();
    const stats = {unit: 'XML declaration, counted per runtime observation', records: report.requests.length, unattributedRecords: 0};
    for (const request of report.requests) {
        assert.ok(owners.has(request.id), `XML request without a PHP record: ${request.id}`);
        const owner = owners.get(request.id);
        if (owner === unattributed) stats.unattributedRecords++;
        for (const event of request.events) {
            const {file, item} = declarations.get(event.id);
            if (item.family === 'layout' && !countsAsLayoutCoverage(event.type)) continue;
            if (item.effects && !countsAsFamilyCoverage(event.outcome)) continue;
            const unit = event.area ? `${event.id}@${event.area}` : event.id;
            result.add(file, unit, owner, event.hits);
            totals.set(event.id, (totals.get(event.id) || 0) + event.hits);
        }
    }
    for (const {file, item} of declarations.values()) {
        assert.equal(totals.get(item.id) || 0, item.hits || 0, `XML attribution differs from the report: ${file} ${item.id}`);
    }
    return {result, stats};
}

function writeAttribution() {
    const run = read('coverage/run.json').id;
    const attempts = files('coverage/raw/attempts', '.json').map(file => read(`coverage/raw/attempts/${file}`))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
    if (!attempts.length) return null;
    for (const attempt of attempts) assert.equal(attempt.run, run, 'Test attempt from another run');
    const index = new Map(attempts.map((attempt, position) => [attempt.id, position]));
    const collectors = {php: php(index, attempts), javascript: javascript(index), templates: templates(attempts, index), xml: xml(index, run)};
    fs.rmSync('coverage/attribution', {recursive: true, force: true});
    fs.mkdirSync('coverage/attribution');
    const summary = {schemaVersion: 1, run, attempts, collectors: {}};
    for (const [name, {result, stats}] of Object.entries(collectors)) {
        fs.writeFileSync(`coverage/attribution/${name}.json`, JSON.stringify({schemaVersion: 1, run, files: result}));
        summary.collectors[name] = {status: 'collected', ...stats, attributedUnits: result.count(byAnAttempt), unattributedOnlyUnits: result.count(unattributedOnly)};
    }
    fs.writeFileSync('coverage/attribution/index.json', JSON.stringify(summary, null, 2) + '\n');
    return summary;
}

if (require.main === module) {
    const summary = writeAttribution();
    if (summary) {
        const {php, javascript, templates, xml} = summary.collectors;
        console.log(`Attributed ${summary.attempts.length} test attempts: ${php.attributedUnits} PHP lines, ${javascript.attributedUnits} JavaScript counters, ${templates.attributedUnits} template counters, ${xml.attributedUnits} XML declarations.`);
    }
}

module.exports = {writeAttribution};
