// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {failureHtmlFilename, failureSnapshotUnavailable} = require('../cypress/support/failure-html.cjs');

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
