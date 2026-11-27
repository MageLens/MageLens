// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {writeAttribution} = require(projectFile('bin/report-attribution.cjs'));

const [first, retry, other] = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];
const spec = 'src/app/code/Acme/Shop/Test/Playwright/cart.spec.js';
const original = process.cwd();

function workspace(t, change = () => {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-attribution-'));
    t.after(() => {process.chdir(original); fs.rmSync(root, {recursive: true, force: true});});
    process.chdir(root);
    const write = (file, data) => {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, JSON.stringify(data));
    };
    const script = path.resolve('src/app/code/Acme/Shop/view/frontend/web/js/cart.js');
    const attempt = (id, test, retryNumber, outcome, startedAt, finishedAt) => ({run: 'current', id, runner: 'playwright', spec, test,
        retry: retryNumber, project: '', worker: 0, startedAt, finishedAt, outcome});
    const data = {
        'coverage/run.json': {id: 'current', runner: 'playwright'},
        [`coverage/raw/attempts/${first}.json`]: attempt(first, ['cart', 'adds'], 0, 'failed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:10.000Z'),
        [`coverage/raw/attempts/${retry}.json`]: attempt(retry, ['cart', 'adds'], 1, 'passed', '2026-01-01T00:00:11.000Z', '2026-01-01T00:00:20.000Z'),
        [`coverage/raw/attempts/${other}.json`]: attempt(other, ['cart', 'removes'], 0, 'passed', '2026-01-01T00:00:21.000Z', '2026-01-01T00:00:30.000Z'),
        // Line 12 runs in both attempts of one test, 13 in one attempt only, 14 in shared setup, 15 nowhere.
        'coverage/php/line-coverage.json': {'app/code/Acme/Shop/Model/Cart.php': {12: 1, 13: 1, 14: 1, 15: 0}},
        'coverage/php/attribution.json': {tests: {0: first, 1: 'unattributed', 2: retry},
            lines: {'app/code/Acme/Shop/Model/Cart.php': {12: [0, 2], 13: [2], 14: [1]}}},
        'coverage/php/coverage-summary.json': {requests: [
            {attempt: first, startedAt: '2026-01-01T00:00:01.000Z'}, {attempt: retry, startedAt: '2026-01-01T00:00:12.000Z'},
            {attempt: retry, startedAt: '2026-01-01T00:00:20.500Z'}, {attempt: null, startedAt: '2026-01-01T00:00:00.500Z'}], commands: []},
        '.nyc_output/out.json': {[script]: {s: {0: 4, 1: 0}, f: {0: 1}, b: {0: [2, 0]}}},
        [`coverage/raw/javascript-attempts/${retry}.json`]: {[script]: {s: {0: 3}, f: {0: 1}, b: {0: [2, 0]}}},
        'coverage/templates/coverage-summary.json': {templates: [{id: 't1', path: 'app/code/Acme/Shop/view/frontend/templates/cart.phtml',
            statements: [{id: 'binding:1', hits: 3}, {id: 'binding:2', hits: 0}], functions: [], branches: []}]},
        // Playwright stores the absolute spec and starts the title path with the spec file.
        'coverage/raw/templates/1.mtc': {spec: path.resolve(spec), test: [spec, 'cart', 'adds'], retry: 1, project: '', hits: {t1: {'binding:1': 2}}},
        // XML evidence of a browser request, a request without an attempt and a CLI command, named as in the XML report.
        'coverage/raw/php/current/r1.json': {attempt: first}, 'coverage/raw/php/current/r2.json': {attempt: null},
        'coverage/raw/php/current/c1.json': {attempt: retry, commandId: 'c1'},
        // A worker forked by that command shares its record name and attempt.
        'coverage/raw/php/current/c1.4321.json': {attempt: retry, commandId: 'c1'},
        'coverage/xml/coverage.json': {files: [{path: 'app/code/Acme/Shop/etc/config.xml', declarations: [{id: 'd1', hits: 5}, {id: 'd2', hits: 0}, {id: 'd3', hits: 1}]}],
            requests: [{id: 'r1', events: [{id: 'd1', hits: 2}, {id: 'd3', area: 'frontend', hits: 1}]}, {id: 'r2', events: [{id: 'd1', hits: 1}]},
                {id: 'c1', events: [{id: 'd1', hits: 1}, {id: 'd1', hits: 1}]}]},
        'coverage/raw/templates/2.mtc': {spec: path.resolve(spec), test: [spec, 'cart', 'unknown'], retry: 0, project: '', hits: {t1: {'binding:1': 1}}}
    };
    change(data);
    for (const [file, contents] of Object.entries(data)) write(file, contents);
    return {script, read: name => JSON.parse(fs.readFileSync(`coverage/attribution/${name}.json`, 'utf8'))};
}

test('attribution lists the attempts that executed each unit and keeps shared work unattributed', t => {
    const fixture = workspace(t);
    const summary = writeAttribution();
    assert.deepEqual(summary.attempts.map(attempt => [attempt.id, attempt.retry, attempt.outcome]), [[first, 0, 'failed'], [retry, 1, 'passed'], [other, 0, 'passed']]);
    assert.deepEqual(fixture.read('php').files, {'app/code/Acme/Shop/Model/Cart.php': {12: {0: 1, 1: 1}, 13: {1: 1}, 14: {unattributed: 1}}});
    assert.deepEqual(summary.collectors.php, {status: 'collected', unit: 'line', records: 4, unattributedRecords: 1, lateRecords: 1,
        attributedUnits: 2, unattributedOnlyUnits: 1});
    assert.deepEqual(fixture.read('javascript').files, {'app/code/Acme/Shop/view/frontend/web/js/cart.js': {
        'b:0:0': {1: 2}, 'f:0': {1: 1}, 's:0': {1: 3, unattributed: 1}}});
    assert.deepEqual(fixture.read('templates').files, {'app/code/Acme/Shop/view/frontend/templates/cart.phtml': {'binding:1': {1: 2, unattributed: 1}}});
    assert.deepEqual([summary.collectors.templates.records, summary.collectors.templates.unattributedRecords], [2, 1]);
    assert.deepEqual(fixture.read('xml').files, {'app/code/Acme/Shop/etc/config.xml': {d1: {0: 2, 1: 2, unattributed: 1}, 'd3@frontend': {0: 1}}});
    assert.deepEqual([summary.collectors.xml.records, summary.collectors.xml.unattributedRecords, summary.collectors.xml.attributedUnits], [3, 1, 2]);
    assert.deepEqual(JSON.parse(fs.readFileSync('coverage/attribution/index.json', 'utf8')), JSON.parse(JSON.stringify(summary)));
});

test('XML attribution counts the same coverage events as the XML report', t => {
    const layout = 'app/code/Acme/Shop/view/frontend/layout/cart.xml';
    const cron = 'app/code/Acme/Shop/etc/crontab.xml';
    const fixture = workspace(t, data => {
        const report = data['coverage/xml/coverage.json'];
        report.files.push(
            {path: layout, declarations: [{id: 'layout', family: 'layout', hits: 2}]},
            {path: cron, declarations: [{id: 'cron', family: 'cron', effects: ['cron-callback-entered'], hits: 1}]}
        );
        report.requests[0].events.push(
            {id: 'layout', type: 'layout-argument-applied', area: 'frontend', hits: 2},
            {id: 'layout', type: 'layout-argument-application-unconfirmed', area: 'frontend', hits: 3},
            {id: 'cron', type: 'cron-callback-entered', outcome: 'entered', area: 'crontab', hits: 1},
            {id: 'cron', type: 'cron-callback-entered', outcome: 'failed', area: 'crontab', hits: 1},
            {id: 'cron', type: 'cron-callback-entered', outcome: 'ambiguous', area: 'crontab', hits: 1}
        );
    });
    writeAttribution();
    const {files} = fixture.read('xml');
    assert.deepEqual(files[layout], {'layout@frontend': {0: 2}});
    assert.deepEqual(files[cron], {'cron@crontab': {0: 1}});
});

test('a run without test attempts writes no attribution', t => {
    workspace(t, data => { for (const file of Object.keys(data)) if (file.startsWith('coverage/raw/attempts/')) delete data[file]; });
    assert.equal(writeAttribution(), null);
    assert.equal(fs.existsSync('coverage/attribution'), false);
});

test('attribution that disagrees with the aggregate reports blocks the run', t => {
    const cases = [
        [data => { data['coverage/php/attribution.json'].lines['app/code/Acme/Shop/Model/Cart.php'][15] = [0]; }, /PHP attribution outside the report/],
        [data => { delete data['coverage/php/attribution.json'].lines['app/code/Acme/Shop/Model/Cart.php'][14]; }, /Covered PHP line without attribution/],
        [data => { data['coverage/php/attribution.json'].tests[3] = 'f'.repeat(32); data['coverage/php/attribution.json'].lines['app/code/Acme/Shop/Model/Cart.php'][13] = [3]; }, /unknown attempt/],
        [data => { Object.values(data[`coverage/raw/javascript-attempts/${retry}.json`])[0].s[0] = 5; }, /exceeds the aggregate/],
        [data => { data['coverage/raw/templates/2.mtc'].hits.t1['binding:1'] = 2; }, /Template attribution differs/],
        [data => { data[`coverage/raw/attempts/${other}.json`].run = 'previous'; }, /another run/],
        [data => { data['coverage/xml/coverage.json'].requests[0].events[0].hits = 3; }, /XML attribution differs/],
        [data => { data['coverage/raw/php/current/r2.json'].attempt = 'e'.repeat(32); }, /XML record of an unknown attempt/],
        [data => { data['coverage/xml/coverage.json'].requests[1].id = 'r9'; }, /XML request without a PHP record/]
    ];
    for (const [change, error] of cases) {
        workspace(t, change);
        assert.throws(() => writeAttribution(), error);
        assert.equal(fs.existsSync('coverage/attribution'), false);
    }
});

test('identical template records of two attempts stay unattributed', t => {
    workspace(t, data => { data[`coverage/raw/attempts/${other}.json`].test = ['cart', 'adds']; data[`coverage/raw/attempts/${other}.json`].retry = 1; });
    const summary = writeAttribution();
    assert.deepEqual([summary.collectors.templates.ambiguousRecords, summary.collectors.templates.unattributedRecords], [1, 2]);
});

test('template records that carry their attempt ID are attributed to it, also when titles repeat', t => {
    workspace(t, data => {
        data[`coverage/raw/attempts/${other}.json`].test = ['cart', 'adds'];
        data[`coverage/raw/attempts/${other}.json`].retry = 1;
        Object.assign(data['coverage/raw/templates/1.mtc'], {attempt: other});
    });
    const summary = writeAttribution();
    assert.deepEqual([summary.collectors.templates.ambiguousRecords, summary.collectors.templates.unattributedRecords], [0, 1]);
    assert.deepEqual(JSON.parse(fs.readFileSync('coverage/attribution/templates.json', 'utf8')).files['app/code/Acme/Shop/view/frontend/templates/cart.phtml'],
        {'binding:1': {2: 2, unattributed: 1}});
});

test('a template record of an unknown attempt blocks the run', t => {
    workspace(t, data => { data['coverage/raw/templates/1.mtc'].attempt = 'd'.repeat(32); });
    assert.throws(() => writeAttribution(), /Template record of an unknown attempt/);
});

test('a template record whose attempt ID belongs to another test blocks the run', t => {
    workspace(t, data => { data['coverage/raw/templates/1.mtc'].attempt = first; });
    assert.throws(() => writeAttribution(), /another test's attempt/);
});

test('wrapped Playwright template records use their attempt and title path when the wrapper is reported as the spec', t => {
    workspace(t, data => {
        Object.assign(data['coverage/raw/templates/1.mtc'], {
            spec: path.resolve('playwright/failure-snapshot-hooks.cjs'), test: [spec, 'cart', 'adds'], attempt: retry
        });
    });
    const summary = writeAttribution();
    assert.deepEqual([summary.collectors.templates.unattributedRecords, summary.collectors.templates.ambiguousRecords], [1, 0]);
    assert.deepEqual(JSON.parse(fs.readFileSync('coverage/attribution/templates.json', 'utf8')).files['app/code/Acme/Shop/view/frontend/templates/cart.phtml'],
        {'binding:1': {1: 2, unattributed: 1}});
});

test('Playwright template records match attempts when the testDir is not the project root', t => {
    // Playwright starts the title path with the file relative to its testDir, here playwright/tests.
    const nested = 'playwright/tests/e2e/cart.spec.js';
    workspace(t, data => {
        for (const id of [first, retry, other]) data[`coverage/raw/attempts/${id}.json`].spec = nested;
        Object.assign(data['coverage/raw/templates/1.mtc'], {spec: path.resolve(nested), test: ['e2e/cart.spec.js', 'cart', 'adds'], attempt: retry});
        Object.assign(data['coverage/raw/templates/2.mtc'], {spec: path.resolve(nested), test: ['e2e/cart.spec.js', 'cart', 'adds'], retry: 1});
    });
    const summary = writeAttribution();
    assert.deepEqual([summary.collectors.templates.unattributedRecords, summary.collectors.templates.ambiguousRecords], [0, 0]);
    assert.deepEqual(JSON.parse(fs.readFileSync('coverage/attribution/templates.json', 'utf8')).files['app/code/Acme/Shop/view/frontend/templates/cart.phtml'],
        {'binding:1': {1: 3}});
});
