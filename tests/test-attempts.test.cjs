// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {newAttemptId, isAttemptId, startAttempt, finishAttempt, recordJavascript} = require('../bin/test-attempts.cjs');
const {sparseCounters, mergeCounters} = require('../bin/javascript-attempts.cjs');

const read = id => JSON.parse(fs.readFileSync(`coverage/raw/attempts/${id}.json`, 'utf8'));

function workspace(t) {
    const cwd = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-attempts-'));
    t.after(() => {process.chdir(cwd); fs.rmSync(root, {recursive: true, force: true});});
    process.chdir(root);
    fs.mkdirSync('coverage');
    fs.writeFileSync('coverage/run.json', JSON.stringify({id: 'current-run'}));
}

test('an attempt records its test identity once and its outcome when it finishes', t => {
    workspace(t);
    const id = newAttemptId();
    assert.ok(isAttemptId(id));
    assert.equal(startAttempt({id, runner: 'playwright', spec: 'playwright/e2e/cart.spec.js', test: ['cart', 'adds a product'],
        retry: 0, project: 'chrome', worker: 1}), null);
    const started = read(id);
    assert.deepEqual({...started, startedAt: null}, {run: 'current-run', id, runner: 'playwright', spec: 'playwright/e2e/cart.spec.js',
        test: ['cart', 'adds a product'], retry: 0, project: 'chrome', worker: 1, startedAt: null, finishedAt: null, outcome: null});
    assert.ok(!Number.isNaN(Date.parse(started.startedAt)));
    assert.equal(finishAttempt({id, outcome: 'passed'}), null);
    const finished = read(id);
    assert.equal(finished.outcome, 'passed');
    assert.ok(Date.parse(finished.finishedAt) >= Date.parse(started.startedAt));
    assert.equal(finished.startedAt, started.startedAt);
});

test('a retry is a separate attempt that keeps the failed attempt before it', t => {
    workspace(t);
    const [first, retry] = [newAttemptId(), newAttemptId()];
    assert.notEqual(first, retry);
    const identity = {runner: 'cypress', spec: 'cypress/e2e/cart.cy.js', test: ['cart', 'adds a product']};
    startAttempt({id: first, ...identity, retry: 0});
    finishAttempt({id: first, outcome: 'failed'});
    startAttempt({id: retry, ...identity, retry: 1});
    finishAttempt({id: retry, outcome: 'passed'});
    assert.deepEqual([read(first), read(retry)].map(attempt => [attempt.retry, attempt.outcome]), [[0, 'failed'], [1, 'passed']]);
});

test('attempt records reject reused IDs, unknown identities and a second outcome', t => {
    workspace(t);
    const id = newAttemptId();
    const identity = {id, runner: 'cli', spec: 'cli/e2e/cron.test.cjs', test: ['runs cron']};
    startAttempt(identity);
    assert.throws(() => startAttempt(identity), /EEXIST/);
    assert.throws(() => startAttempt({...identity, id: '../escape'}), /Invalid test attempt ID/);
    assert.throws(() => startAttempt({...identity, id: newAttemptId(), runner: 'jest'}), /Unknown runner/);
    assert.throws(() => startAttempt({...identity, id: newAttemptId(), test: []}), /spec and title path/);
    assert.throws(() => startAttempt({...identity, id: newAttemptId(), retry: -1}), /Invalid retry/);
    assert.throws(() => finishAttempt({id, outcome: ''}), /needs its outcome/);
    finishAttempt({id, outcome: 'passed'});
    assert.throws(() => finishAttempt({id, outcome: 'failed'}), /already finished/);
    assert.equal(read(id).outcome, 'passed');
    assert.throws(() => finishAttempt({id: newAttemptId(), outcome: 'passed'}), /ENOENT/);
});

test('JavaScript counters keep only hits and add up across the pages of one attempt', () => {
    const page = (statement, branch, call = 0) => ({'/src/cart.js': {path: '/src/cart.js', statementMap: {}, s: {0: statement, 1: 0}, f: {0: call, 1: 0}, b: {0: branch}},
        '/src/unused.js': {path: '/src/unused.js', s: {0: 0}, f: {0: 0}, b: {0: [0, 0]}}});
    const first = sparseCounters(page(2, [1, 0], 1));
    assert.deepEqual(first, {'/src/cart.js': {s: {0: 2}, f: {0: 1}, b: {0: [1, 0]}}});
    assert.deepEqual(mergeCounters(first, sparseCounters(page(1, [0, 3], 2))), {'/src/cart.js': {s: {0: 3}, f: {0: 3}, b: {0: [1, 3]}}});
    assert.deepEqual(sparseCounters(page(0, [0, 0])), {});
    assert.throws(() => mergeCounters({'/src/cart.js': {b: {0: [1]}}}, first), /changed its paths/);
});

test('JavaScript counters are stored per attempt while it runs', t => {
    workspace(t);
    const [id, other] = [newAttemptId(), newAttemptId()];
    for (const attempt of [id, other]) startAttempt({id: attempt, runner: 'cypress', spec: 'cypress/e2e/cart.cy.js', test: ['cart', attempt]});
    recordJavascript({id, counters: {'/src/cart.js': {s: {0: 1}}}});
    recordJavascript({id, counters: {'/src/cart.js': {s: {0: 2, 4: 1}}}});
    recordJavascript({id: other, counters: {}});
    assert.deepEqual(JSON.parse(fs.readFileSync(`coverage/raw/javascript-attempts/${id}.json`, 'utf8')), {'/src/cart.js': {s: {0: 3, 4: 1}}});
    assert.deepEqual(fs.readdirSync('coverage/raw/javascript-attempts'), [`${id}.json`]);
    finishAttempt({id, outcome: 'passed'});
    assert.throws(() => recordJavascript({id, counters: {'/src/cart.js': {s: {0: 1}}}}), /already finished/);
    assert.throws(() => recordJavascript({id: newAttemptId(), counters: {}}), /ENOENT/);
});
