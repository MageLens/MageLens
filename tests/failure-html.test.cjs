// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {failureHtmlFilename, failureSnapshotUnavailable} = require('../cypress/support/failure-html.cjs');
const {retryAttemptNumber} = require('../cypress/support/failure-metadata.cjs');
const {wrapTestType} = require('../playwright/failure-snapshot-hooks.cjs');

test('failure HTML filenames identify title, run, attempt and worker without unsafe paths', () => {
    const first = failureHtmlFilename('Catalog / Search: shows "result"', {attempt: 1, runId: 'run-a', workerId: 'worker-a'});
    const retry = failureHtmlFilename('Catalog / Search: shows "result"', {attempt: 2, runId: 'run-a', workerId: 'worker-a'});
    const parallel = failureHtmlFilename('Catalog / Search: shows "result"', {attempt: 1, runId: 'run-a', workerId: 'worker-b'});
    assert.match(first, /^Catalog _ Search_ shows _result_ -- attempt-1 -- run-a -- worker-a \(failed\)\.html$/);
    assert.notEqual(first, retry);
    assert.notEqual(first, parallel);
    assert.doesNotMatch(first, /[\\/]/);
    assert.ok(failureHtmlFilename('a'.repeat(300), {runId: 'run', workerId: 'w'}).length < 220);
});

test('unavailable snapshots retain a small HTML diagnostic and escaped metadata', () => {
    const html = failureSnapshotUnavailable({test: 'fails <unsafe>', attempt: 2}, 'browser closed <early>');
    assert.match(html, /HTML snapshot unavailable/);
    assert.match(html, /&lt;unsafe&gt;/);
    assert.match(html, /&lt;early&gt;/);
    assert.ok(Buffer.byteLength(html) < 10000);
});

test('Cypress retry attempt reads the failing runnable before currentTest fallbacks', () => {
    assert.equal(retryAttemptNumber({currentRetry: () => 1}, {currentRetry: () => 0}), 2);
    assert.equal(retryAttemptNumber({currentRetry: () => { throw new Error('unavailable'); }}, {_currentRetry: 2}), 3);
    assert.equal(retryAttemptNumber({currentRetry: () => 0}), 1);
});

test('Playwright test callbacks capture failure before later hooks and preserve expected failures', async () => {
    const definitions = [];
    const hooks = [];
    const base = function (...args) { definitions.push(args); };
    base.extend = () => base;
    base.beforeEach = (...args) => hooks.push(args);
    base.afterEach = (...args) => hooks.push(args);
    const captures = [];
    const wrapped = wrapTestType(base, async (...args) => captures.push(args));

    wrapped('first passing spec', async () => {});
    wrapped('later failing spec', async ({context}) => {
        throw Object.assign(new Error('assertion failed'), {context});
    });
    const fixtures = {context: {name: 'application page'}};
    const testInfo = {expectedStatus: 'passed'};
    await assert.rejects(definitions[1][1](fixtures, testInfo), /assertion failed/);
    assert.deepEqual(captures[0], [fixtures.context, testInfo, 'test-body', 'assertion failed']);

    wrapped.afterEach('nested cleanup', async () => { throw new Error('cleanup failed'); });
    const cleanup = hooks[0].at(-1);
    await assert.rejects(cleanup(fixtures, testInfo), /cleanup failed/);
    assert.equal(captures[1][2], 'afterEach-hook');

    wrapped('expected failure', async () => { throw new Error('expected'); });
    await assert.rejects(definitions[2][1](fixtures, {expectedStatus: 'failed'}), /expected/);
    assert.equal(captures.length, 2);
});
