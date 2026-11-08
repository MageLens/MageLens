// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {matrix} = require('./matrix.cjs');
const policy = require('./ci-policy.json');
function verifyResults(results, context, {allowBootstrap = false} = {}) {
    assert.equal(results.length, matrix.length, 'The complete performance matrix is required');
    assert.deepEqual(results.map((result) => result.row).sort(), matrix.map((row) => row.id).sort());
    for (const result of results) {
        assert.equal(result.installationCleanup, true, 'Installation cleanup is incomplete');
        assert.equal(result.storageCleanup, true, 'Storage cleanup is incomplete');
        assert.ok(
            (allowBootstrap ? ['passed', 'baseline-required'] : ['passed']).includes(result.status),
            'Unqualified performance row'
        );
        const candidate = result.referenceCandidate;
        assert.equal(candidate.row, result.row);
        assert.equal(candidate.provenance.commit, context.sha, 'Wrong performance commit');
        assert.equal(candidate.provenance.runUrl, context.runUrl, 'Different performance run');
        assert.equal(candidate.provenance.attempt, context.attempt, 'Stale performance attempt');
        assert.equal(candidate.environment.provider, 'github-actions');
        assert.equal(candidate.environment.runner, policy.runner);
        assert.equal(candidate.pairs, policy.pairs);
        for (const arm of ['linear', 'branching'])
            for (const metric of ['setupMs', 'testsMs', 'totalMs'])
                assert.ok(
                    Number.isFinite(candidate.medians[arm][metric]) && candidate.medians[arm][metric] > 0
                );
        assert.equal(candidate.checkpoints.length, policy.pairs);
        assert.equal(candidate.restores.length, policy.pairs);
    }
    return results.map((result) => result.referenceCandidate);
}
function readResults(root, attempt) {
    return matrix.map((row) =>
        JSON.parse(
            fs.readFileSync(path.join(root, `performance-${row.id}-attempt-${attempt}`, 'result.json'))
        )
    );
}
module.exports = {verifyResults, readResults};
if (require.main === module) {
    const [root, sha, run, attempt, output] = process.argv.slice(2);
    assert.match(sha ?? '', /^[a-f0-9]{40}$/);
    assert.match(run ?? '', /^\d+$/);
    const context = {
        sha,
        runUrl: `https://github.com/MageLens/MageLens/actions/runs/${run}`,
        attempt: Number(attempt)
    };
    assert.ok(Number.isSafeInteger(context.attempt) && context.attempt > 0);
    const rows = verifyResults(readResults(root, context.attempt), context, {allowBootstrap: true});
    fs.writeFileSync(
        output,
        JSON.stringify(
            {schemaVersion: 2, environment: 'github-actions', status: 'qualified', rows},
            null,
            2
        ) + '\n',
        {flag: 'wx'}
    );
}
