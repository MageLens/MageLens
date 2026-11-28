// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Checks the published report of a run with one deliberately failing test (tests/fixtures/failed-run).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => JSON.parse(fs.readFileSync(path.join('coverage', file), 'utf8'));
const {id: run, runner} = read('run.json');
const label = runner === 'playwright' ? 'Playwright' : 'Cypress';
const failed = 'fails after opening the storefront';
const summary = read('summary.json');
assert.equal(summary.run, run, 'The published summary belongs to another run');
assert.deepEqual(summary.tests[runner], {status: 'failed', passed: 1, failed: 1, failedTests: [failed]});
assert.equal(summary.tests.cli.status, 'passed');
assert.match(fs.readFileSync(`coverage/badges/${runner}.svg`, 'utf8'), /50% \(1\/2\) - Failed/);
const html = fs.readFileSync('coverage/index.html', 'utf8');
assert.ok(html.includes(`<span class="status failed">${label} failed · 1/2 tests</span>`), 'The report must show the failed suite');
assert.ok(html.includes(`<ul><li>${failed}</li></ul>`), 'The report must list the failed test');

// The failed attempt keeps the coverage it produced before it failed.
const attribution = read('attribution/index.json');
assert.equal(attribution.run, run);
const position = attribution.attempts.findIndex(attempt => attempt.runner === runner && attempt.test.at(-1) === failed);
assert.ok(position >= 0, 'Missing the failed test attempt');
assert.equal(attribution.attempts[position].outcome, 'failed');
const php = read('attribution/php.json');
assert.ok(Object.values(php.files).some(lines => Object.values(lines).some(owners => owners[position] > 0)),
    'No PHP line is attributed to the failed attempt');
console.log(`Verified the published report of failed run ${run} and the coverage of its failed attempt.`);
