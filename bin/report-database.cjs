// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Writes coverage/report.sqlite from the collector exports of a finished run
// (docs/coverage.md#coverage-database). The schema lives in report-schema.sql.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');

const schema = fs.readFileSync(path.join(__dirname, 'report-schema.sql'), 'utf8');
const schemaVersion = Number(schema.match(/^PRAGMA user_version = (\d+);$/m)[1]);
const xmlMetrics = {events: 'observers', plugins: 'plugins', preferences: 'preferences',
    'virtual-types': 'virtual-types', arguments: 'arguments', lifecycles: 'lifecycles'};

function moduleName(file) {
    const parts = file.split('/');
    if (parts[0] === 'app' && parts[1] === 'code') return `${parts[2]}_${parts[3]}`;
    if (parts[0] === 'app' && parts[1] === 'design') return `design/${parts.slice(2, 5).join('/')}`;
    return parts.slice(0, 3).join('/');
}

// Reads the checked-out commit without Git: the runner image does not ship it.
// Returns null when the commit cannot be resolved from the files in the checkout.
function commitSha(root) {
    try {
        let gitDirectory = path.join(root, '.git');
        // In a worktree or submodule .git is a file that points to the real directory.
        if (fs.statSync(gitDirectory).isFile()) {
            gitDirectory = path.resolve(root, fs.readFileSync(gitDirectory, 'utf8').trim().replace(/^gitdir: /, ''));
        }
        const head = fs.readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim();
        if (/^[a-f0-9]{40}$/.test(head)) return head;
        const ref = head.replace(/^ref: /, '');
        const common = path.join(gitDirectory, 'commondir');
        const refDirectory = fs.existsSync(common) ? path.resolve(gitDirectory, fs.readFileSync(common, 'utf8').trim()) : gitDirectory;
        const loose = path.join(refDirectory, ref);
        if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
        const packed = fs.readFileSync(path.join(refDirectory, 'packed-refs'), 'utf8').split('\n').find(line => line.endsWith(' ' + ref));
        return packed.split(' ')[0];
    } catch {
        return null;
    }
}

// Each unit is {type, source, metric, key, file, start, end, hits}; hits is a count,
// true for "ran, count unknown", or 0/false for an eligible unit that did not run.
function* phpUnits(lines) {
    for (const [file, fileLines] of Object.entries(lines)) {
        for (const [line, hit] of Object.entries(fileLines)) {
            yield {type: 'line', source: 'php', metric: 'lines', key: line, file, start: Number(line), end: Number(line), hits: hit === 1};
        }
    }
}

function* javascriptUnits(coverage, scope) {
    for (const {path: file, coveragePath} of scope.included) {
        const data = coverage[coveragePath];
        const unit = (type, metric, key, location, hits) => ({type, source: 'js', metric, key, file,
            start: location?.start?.line ?? null, end: location?.end?.line ?? location?.start?.line ?? null, hits});
        for (const [id, location] of Object.entries(data.statementMap)) yield unit('statement', 'statements', id, location, data.s[id]);
        for (const [id, fn] of Object.entries(data.fnMap)) yield unit('function', 'functions', id, fn.loc, data.f[id]);
        for (const [id, branch] of Object.entries(data.branchMap)) {
            // An implicit else has no location of its own; it belongs to the branch statement.
            for (const [index, location] of branch.locations.entries()) {
                yield unit('branch', 'branches', `${id}:${index}`, location.start?.line ? location : branch.loc, data.b[id][index]);
            }
        }
    }
}

function* templateUnits(templates) {
    for (const entry of templates.templates.filter(entry => entry.instrumented)) {
        const unit = (type, metric, key, start, end, hits) => ({type, source: 'template', metric, key: String(key), file: entry.path,
            start: start ?? null, end: end ?? start ?? null, hits});
        yield unit('template', 'dom-presence', 'template', null, null, entry.status === 'observed' && entry.observations);
        for (const [line, counts] of Object.entries(entry.lineHits)) yield unit('line', 'executable-lines', line, Number(line), Number(line), counts.hits);
        for (const [type, metric] of [['statement', 'statements'], ['function', 'functions'], ['branch', 'branches']]) {
            for (const item of entry[metric]) yield unit(type, metric, item.id, item.start?.line, item.end?.line, item.hits);
        }
    }
}

function* xmlUnits(xml) {
    for (const file of xml.files) {
        // DI declaration files are measured per declaration and area, not per line.
        if (file.family !== 'plugins') {
            for (const [line, outcome] of Object.entries(file.lines)) {
                if (outcome.state !== 'unmeasured') {
                    yield {type: 'line', source: 'xml', metric: 'lines', key: line, file: file.path, start: Number(line), end: Number(line), hits: outcome.hits};
                }
            }
        }
        for (const item of file.declarations) {
            for (const [area, outcome] of Object.entries(item.areas || {})) {
                if (outcome.status === 'eligible') {
                    yield {type: 'declaration', source: 'xml', metric: xmlMetrics[item.family], key: `${item.id}@${area}`, file: file.path,
                        start: item.startLine, end: item.endLine, hits: outcome.hits};
                }
            }
        }
    }
}

// Units of coverage/attribution/ files, mapped to record keys: [source_type, metric, key] per unit.
const attributionUnits = {
    php: unit => [['php', 'lines', unit]],
    javascript: unit => {
        const [type, id, path] = unit.split(':');
        return [['js', {s: 'statements', f: 'functions', b: 'branches'}[type], path === undefined ? id : `${id}:${path}`]];
    },
    // Template ids are unique across statements, functions and branches of one template.
    templates: unit => ['statements', 'functions', 'branches'].map(metric => ['template', metric, unit]),
    // Area-specific declarations are records of their own; config reads and field renders count on the lines they span.
    xml: (unit, declarations) => unit.includes('@') ? Object.values(xmlMetrics).map(metric => ['xml', metric, unit]) : declarationLines(declarations, unit)
};
// The XML report also counts area-specific declarations on the lines they span, except in plugin files.
const attributionLines = {xml: (unit, declarations) => unit.includes('@') ? declarationLines(declarations, unit.split('@')[0]) : []};
function declarationLines(declarations, id) {
    assert.ok(declarations.has(id), `Attributed XML declaration missing from the XML report: ${id}`);
    const {start, end} = declarations.get(id);
    return Array.from({length: end - start + 1}, (_, offset) => ['xml', 'lines', String(start + offset)]);
}

function writeAttribution(database, directory, run, xml) {
    const file = name => path.join(directory, 'attribution', name);
    const addManifest = database.prepare('INSERT INTO manifest SELECT ?, schema_version, run_id, generated_at, commit_sha, ?, ?, ?, ? FROM manifest LIMIT 1');
    const scope = 'Which test attempt reached which record (tables attempts, attempt_hits and unattributed_hits).';
    if (!fs.existsSync(file('index.json'))) {
        addManifest.run('test-attribution', 'not_collected', scope, '[]', '[]');
        return;
    }
    const index = JSON.parse(fs.readFileSync(file('index.json'), 'utf8'));
    assert.equal(index.run, run.id, 'Test attribution belongs to another run');
    const addAttempt = database.prepare('INSERT INTO attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    index.attempts.forEach((attempt, position) => addAttempt.run(position, attempt.id, attempt.runner, attempt.spec, JSON.stringify(attempt.test),
        attempt.test.join(' › '), attempt.retry, attempt.project ?? null, attempt.startedAt, attempt.finishedAt, attempt.outcome));
    const findRecord = database.prepare('SELECT r.record_id, h.record_id IS NOT NULL AS covered FROM records r LEFT JOIN hits h USING (record_id) WHERE file_path = ? AND source_type = ? AND metric = ? AND record_key = ?');
    const addAttemptHit = database.prepare('INSERT INTO attempt_hits VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET hit_count = hit_count + excluded.hit_count');
    const addUnattributed = database.prepare('INSERT INTO unattributed_hits VALUES (?, ?) ON CONFLICT DO UPDATE SET hit_count = hit_count + excluded.hit_count');
    // Lines as the XML report paints them (bin/report-xml.cjs).
    const xmlLines = new Map(xml.files.flatMap(xmlFile => xmlFile.declarations.map(item => [item.id, {start: item.startLine, end: item.highlightEndLine ?? item.endLine}])));
    for (const collector of ['php', 'javascript', 'templates', 'xml']) {
        const attribution = JSON.parse(fs.readFileSync(file(`${collector}.json`), 'utf8'));
        assert.equal(attribution.run, run.id, `The ${collector} attribution belongs to another run`);
        for (const [sourceFile, units] of Object.entries(attribution.files)) {
            for (const [unit, owners] of Object.entries(units)) {
                const find = keys => keys.map(([source, metric, key]) => findRecord.get(sourceFile, source, metric, key)).filter(Boolean);
                let matches = find(attributionUnits[collector](unit, xmlLines));
                // A config read or field render owns every measured line of its declaration.
                if (collector === 'xml' && !unit.includes('@')) matches = matches.filter(record => record.covered);
                else assert.ok(matches.length <= 1, `Attributed ${collector} unit with several records: ${sourceFile} ${unit}`);
                assert.ok(matches.length, `Attributed ${collector} unit without a covered record: ${sourceFile} ${unit}`);
                for (const record of matches) assert.ok(record.covered, `Attributed ${collector} unit that the report shows as uncovered: ${sourceFile} ${unit}`);
                const lines = find(attributionLines[collector]?.(unit, xmlLines) || []).filter(record => record.covered);
                for (const record of [...matches, ...lines]) {
                    for (const [owner, hits] of Object.entries(owners)) {
                        // PHP records whether a line ran, not how often.
                        const count = collector === 'php' ? null : hits;
                        if (owner === 'unattributed') addUnattributed.run(record.record_id, count);
                        else addAttemptHit.run(Number(owner), record.record_id, count);
                    }
                }
            }
        }
    }
    // Every covered unit of an attributed metric has an owner: an attempt or unattributed work.
    const missing = database.prepare(`SELECT r.source_type, r.metric, r.file_path, r.record_key FROM records r JOIN hits USING (record_id)
        WHERE NOT (r.source_type = 'template' AND r.metric IN ('executable-lines', 'dom-presence'))
        AND NOT EXISTS (SELECT 1 FROM attempt_hits a WHERE a.record_id = r.record_id)
        AND NOT EXISTS (SELECT 1 FROM unattributed_hits u WHERE u.record_id = r.record_id) LIMIT 1`).get();
    assert.equal(missing, undefined, `Covered unit without attribution: ${JSON.stringify(missing)}`);
    addManifest.run('test-attribution', 'collected', scope, JSON.stringify([
        {id: 'unattributed-metrics', count: 2, description: 'Template executable lines and DOM presence are not attributed; query their statements and templates instead.'}
    ]), JSON.stringify(['attribution/index.json', 'attribution/php.json', 'attribution/javascript.json', 'attribution/templates.json', 'attribution/xml.json']));
}

function writeDatabase({directory = 'coverage', root = '.', run, generatedAt, php, js, templates, templateLimitations, xml}) {
    const read = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    // Built on local disk and copied once: the coverage directory can be a slow bind mount.
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-report-'));
    const temporary = path.join(workspace, 'report.sqlite');
    const database = new DatabaseSync(temporary);
    try {
        database.exec(schema);
        const addRecord = database.prepare('INSERT INTO records (record_type, source_type, metric, record_key, file_path, module_name, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const addHit = database.prepare('INSERT INTO hits (record_id, hit_count) VALUES (?, ?)');
        const addManifest = database.prepare('INSERT INTO manifest VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const sha = commitSha(root);
        const manifest = (collector, status, scope, limitations, exports) => addManifest.run(collector, schemaVersion, run.id, generatedAt, sha, status, scope,
            JSON.stringify(limitations.filter(limitation => limitation.count > 0)), JSON.stringify(exports));
        // One transaction: the prepared inserts are batched into a single write.
        database.exec('BEGIN');
        for (const units of [phpUnits(read('php/line-coverage.json')), javascriptUnits(read('js/coverage-final.json'), read('javascript-scope.json')),
            templateUnits(templates), xmlUnits(xml)]) {
            for (const unit of units) {
                const {lastInsertRowid} = addRecord.run(unit.type, unit.source, unit.metric, unit.key, unit.file, moduleName(unit.file), unit.start, unit.end);
                if (unit.hits) addHit.run(lastInsertRowid, unit.hits === true ? null : unit.hits);
            }
        }
        manifest('php', 'collected', 'Executable PHP lines in .php and .phtml files, from HTTP requests and Magento CLI commands. Metric: lines.',
            [], ['php/line-coverage.json', 'php/clover.xml']);
        manifest('js', 'collected', 'Whole .js files executed in the browser. Metrics: statements, functions, branches.',
            [], ['js/coverage-final.json', 'js/coverage-summary.json', 'javascript-summary.json', 'javascript-scope.json']);
        manifest('template', 'collected', 'HTML/PHTML bindings, template expressions and inline scripts. Metrics: executable-lines, statements, functions, branches, and dom-presence for templates that entered a tested document.', [
            {id: 'unsupported-directives', count: templateLimitations.directives.length, description: 'Template directives that cannot be measured; they have no records.'},
            {id: 'unsupported-scripts', count: templateLimitations.scripts.length, description: 'Inline scripts that cannot be instrumented; they have no records.'},
            {id: 'unmapped-generated-scripts', count: templateLimitations.generated.length, description: 'PHP-generated script fragments without a static source mapping; they have no records.'}
        ], ['templates/coverage-summary.json']);
        manifest('xml', 'collected', 'Runtime config value consumption and Admin field rendering (metric lines); observer registrations and DI declarations per configuration area (metrics observers, plugins, preferences, virtual-types, arguments, lifecycles).', [
            {id: 'measurement-warnings', count: xml.warnings.length, description: 'Unsupported or ambiguous XML is unmeasured and has no records; see warnings in xml/coverage.json.'}
        ], ['xml/coverage.json']);
        writeAttribution(database, directory, run, xml);
        database.exec('COMMIT');

        // The database must agree with the reports people read for the same run.
        const totals = database.prepare('SELECT source_type, metric, total, covered FROM metric_totals').all();
        const expected = [
            ['php', 'lines', php], ['js', 'statements', js.total.statements], ['js', 'functions', js.total.functions], ['js', 'branches', js.total.branches],
            ['template', 'executable-lines', templates.lines], ['template', 'dom-presence', {total: templates.summary.eligible, covered: templates.summary.covered}],
            ['template', 'statements', templates.statements], ['template', 'functions', templates.functions], ['template', 'branches', templates.branches],
            ['xml', 'lines', xml], ['xml', 'observers', xml.observers], ['xml', 'plugins', xml.plugins], ['xml', 'preferences', xml.preferences],
            ['xml', 'virtual-types', xml.virtualTypes], ['xml', 'arguments', xml.arguments], ['xml', 'lifecycles', xml.lifecycles]
        ];
        for (const [source, metric, summary] of expected) {
            const stored = totals.find(row => row.source_type === source && row.metric === metric) || {total: 0, covered: 0};
            assert.deepEqual([stored.total, stored.covered], [summary.total, summary.covered], `Coverage database differs from the ${source} ${metric} report`);
        }
        database.close();
        fs.copyFileSync(temporary, path.join(directory, 'report.sqlite'));
    } finally {
        if (database.isOpen) database.close();
        fs.rmSync(workspace, {recursive: true, force: true});
    }
    fs.copyFileSync(path.join(__dirname, 'report-schema.sql'), path.join(directory, 'schema.sql'));
}

module.exports = {writeDatabase, moduleName, commitSha, schemaVersion};
