// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const {assess} = require('./performance/branching/ci-report.cjs');
test('CI schedules every reusable performance matrix row', () => {
    const fs=require('node:fs'),path=require('node:path');
    const {matrix}=require('./performance/branching/matrix.cjs');
    const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/ci.yml'),'utf8');
    const rows=workflow.match(/row: \[([^\]]+)\]/)[1].split(',').map(row=>row.trim());
    assert.deepEqual(rows.sort(),matrix.map(row=>row.id).sort());
});
const environment = {
    provider: 'github-actions',
    runner: 'ubuntu-24.04',
    cpu: 'fixture',
    browser: 'pinned',
    workloadDigest: 'fixture'
};
const provenance = {
    commit: 'a'.repeat(40),
    runUrl: 'https://github.com/MageLens/MageLens/actions/runs/123',
    attempt: 1
};
function pairs(factor = 1) {
    const arm = (branching) => ({
        status: 'passed',
        tests: ['setup', 'a', 'b', 'c', 'd', 'e'],
        passed: 6,
        setupMs: 1000,
        testsMs: branching ? 10000 * factor : 20000,
        totalMs: 1000 + (branching ? 10000 * factor : 20000),
        phpDigest: 'same',
        seedDigest: 'same',
        sourceDigest: 'same',
        browser: 'pinned',
        checkpoints: branching ? 1 : 0,
        restores: branching ? 4 : 0,
        fallbacks: 0,
        cleanup: true
    });
    return [1, 2, 3].map((pair) => ({row: 'strong-5', pair, linear: arm(false), branching: arm(true)}));
}
const run = (samples = pairs(), reference, env = environment) =>
    assess('strong-5', samples, env, provenance, reference);
test('missing or different CI environment requires fresh references rather than desktop numbers', () => {
    const first = run();
    assert.equal(first.status, 'baseline-required');
    assert.equal(first.matrixRefreshRequired, true);
    const reference = first.referenceCandidate;
    assert.equal(run(pairs(), reference).status, 'passed');
    assert.equal(run(pairs(), reference, {...environment, cpu: 'different'}).status, 'baseline-required');
    assert.throws(() => run(pairs(), reference, {...environment, provider: 'desktop'}));
    assert.throws(() => run(pairs(), {...reference, provenance: {...provenance, runUrl: 'file:///desktop'}}));
});
test('regressions fail and improvements flag a matrix refresh without replacing the reference', () => {
    const reference = run().referenceCandidate,
        original = structuredClone(reference);
    const slower = run(pairs(1.25), reference);
    assert.equal(slower.status, 'regression');
    assert.ok(slower.regressions.length);
    const faster = run(pairs(0.75), reference);
    assert.equal(faster.status, 'passed');
    assert.ok(faster.improvements.length);
    assert.equal(faster.matrixRefreshRequired, true);
    assert.deepEqual(reference, original);
});
test('incomplete, duplicated, mismatched and non-branching positive rows cannot qualify', () => {
    const reference = run().referenceCandidate;
    assert.throws(() => run(pairs().slice(0, 2), reference));
    const duplicate = pairs();
    duplicate[2].pair = 2;
    assert.throws(() => run(duplicate, reference));
    for (const patch of [
        {passed: 5},
        {fallbacks: 1},
        {cleanup: false},
        {sourceDigest: 'other'},
        {checkpoints: 0, restores: 0},
        {status: 'failed'},
        {testsMs: NaN}
    ]) {
        const samples = pairs();
        Object.assign(samples[0].branching, patch);
        assert.throws(() => run(samples, reference));
    }
});

test('reference promotion and the required gate demand every row from the same commit and attempt', () => {
    const {verifyResults} = require('./performance/branching/ci-reference.cjs');
    const {matrix} = require('./performance/branching/matrix.cjs');
    const context = {sha: provenance.commit, runUrl: provenance.runUrl, attempt: 1};
    const results = matrix.map((row) => ({
        row: row.id,
        status: 'baseline-required',
        installationCleanup: true,
        storageCleanup: true,
        referenceCandidate: {...run().referenceCandidate, row: row.id}
    }));
    assert.equal(verifyResults(results, context, {allowBootstrap: true}).length, matrix.length);
    assert.throws(() => verifyResults(results, context), /Unqualified/);
    assert.throws(() => verifyResults(results.slice(1), context, {allowBootstrap: true}));
    for (const field of ['sha', 'runUrl', 'attempt']) {
        assert.throws(() =>
            verifyResults(
                results,
                {...context, [field]: field === 'attempt' ? 2 : 'other'},
                {allowBootstrap: true}
            )
        );
    }
    const qualified = structuredClone(results);
    qualified.forEach((row) => (row.status = 'passed'));
    assert.equal(verifyResults(qualified, context).length, matrix.length);
    for (const field of ['installationCleanup', 'storageCleanup']) {
        const incomplete = structuredClone(qualified);
        incomplete[0][field] = false;
        assert.throws(() => verifyResults(incomplete, context), /cleanup is incomplete/);
    }
});
