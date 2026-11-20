// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {writeAttribution} = require('../bin/report-attribution.cjs');

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
    assert.equal(summary.collectors.xml.status, 'not_collected');
    assert.deepEqual(JSON.parse(fs.readFileSync('coverage/attribution/index.json', 'utf8')), JSON.parse(JSON.stringify(summary)));
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
        [data => { data[`coverage/raw/attempts/${other}.json`].run = 'previous'; }, /another run/]
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
