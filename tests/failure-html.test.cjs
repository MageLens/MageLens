// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {failureHtmlFilename, failureSnapshotUnavailable} = require(projectFile('cypress/support/failure-html.cjs'));
const {retryAttemptNumber} = require(projectFile('cypress/support/failure-metadata.cjs'));
const {observeTestFailures} = require(projectFile('playwright/failure-snapshot-hooks.cjs'));

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

test('Playwright records the original error before starting diagnostics', () => {
    const captures = [];
    const error = new Error('original assertion');
    const report = function (failure) {
        assert.equal(this, testInfo);
        this.status = 'failed';
        this.errors.push(failure);
        return 'reported';
    };
    const testInfo = {expectedStatus: 'passed', status: 'passed', errors: [],
        _failWithError: report, _currentHookType: () => 'beforeEach'};
    const restore = observeTestFailures(testInfo, (phase, reason) => {
        assert.equal(testInfo.errors[0], error);
        captures.push([phase, reason]);
        throw new Error('diagnostic failed');
    });

    assert.equal(testInfo._failWithError(error), 'reported');
    assert.deepEqual(captures, [['beforeEach-hook', 'original assertion']]);
    assert.deepEqual(testInfo.errors, [error]);
    restore();
    assert.equal(testInfo._failWithError, report);
});

test('Playwright diagnostics do not record expected failures', () => {
    const testInfo = {
        expectedStatus: 'failed',
        status: 'passed',
        _failWithError() { this.status = 'failed'; }
    };
    let captures = 0;
    observeTestFailures(testInfo, () => { captures++; });
    testInfo._failWithError(new Error('expected assertion failure'));
    assert.equal(testInfo.status, 'failed');
    assert.equal(captures, 0);
});
