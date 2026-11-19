// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Test attempt records for per-test coverage attribution (docs/coverage.md#test-attempts).
// Each attempt of a test gets a random ID. Collectors store only that ID; the test identity
// is written once, here.
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');

const directory = 'coverage/raw/attempts';
const runners = ['cypress', 'playwright', 'cli'];
const isAttemptId = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);

function newAttemptId() {
    return randomBytes(16).toString('hex');
}

function attemptFile(id) {
    if (!isAttemptId(id)) throw new Error('Invalid test attempt ID');
    return path.join(directory, `${id}.json`);
}

// `test` is the title path below the spec, so retries of one test share it.
function startAttempt({id, runner, spec, test, retry = 0, project = null, worker = null}) {
    if (!runners.includes(runner)) throw new Error(`Unknown runner: ${runner}`);
    if (typeof spec !== 'string' || !spec || !Array.isArray(test) || !test.length || !test.every(title => typeof title === 'string')) {
        throw new Error('A test attempt needs its spec and title path');
    }
    if (!Number.isInteger(retry) || retry < 0) throw new Error('Invalid retry number');
    const run = JSON.parse(fs.readFileSync('coverage/run.json', 'utf8')).id;
    fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(attemptFile(id), JSON.stringify({run, id, runner, spec, test, retry, project, worker,
        startedAt: new Date().toISOString(), finishedAt: null, outcome: null}), {flag: 'wx'});
    return null;
}

// The outcome is the runner's own state of this attempt, for example passed, failed, pending (Cypress),
// timedOut, skipped or interrupted (Playwright).
function finishAttempt({id, outcome}) {
    if (typeof outcome !== 'string' || !outcome) throw new Error('A finished attempt needs its outcome');
    const file = attemptFile(id);
    const attempt = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (attempt.finishedAt) throw new Error('This test attempt has already finished');
    fs.writeFileSync(file, JSON.stringify({...attempt, finishedAt: new Date().toISOString(), outcome}));
    return null;
}

module.exports = {newAttemptId, isAttemptId, startAttempt, finishAttempt};
