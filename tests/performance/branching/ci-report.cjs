// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {comparePair, median} = require('./analyze.cjs');
const {matrix} = require('./matrix.cjs');
const policy = require('./ci-policy.json');
const references = require('./references.json');

// Only the workload and measurement contract invalidate a timing comparison.
// Product implementation changes are what the performance gate must compare.
function workloadDigest() {
    const hash = createHash('sha256');
    for (const name of [
        'matrix.cjs',
        'generate.cjs',
        'fixture.php',
        'config.cjs',
        'reporter.cjs',
        'run.py'
    ]) {
        hash.update(name).update(fs.readFileSync(path.join(__dirname, name)));
    }
    return hash.digest('hex');
}
function assess(row, pairs, environment, provenance, reference) {
    const definition = matrix.find((item) => item.id === row);
    assert.ok(definition, 'Unknown performance row');
    assert.equal(pairs.length, policy.pairs, 'Every required pair must finish');
    assert.deepEqual(pairs.map((pair) => pair.pair).sort(), [1, 2, 3], 'Missing or duplicate pairs');
    assert.ok(
        pairs.every((pair) => pair.row === row),
        'Mixed performance rows'
    );
    for (const pair of pairs) {
        comparePair(pair.linear, pair.branching);
        assert.equal(pair.linear.passed, definition.consumers + 1, 'Missing journey or setup test');
        if (definition.expected === 'branching') {
            assert.ok(
                pair.branching.checkpoints > 0 && pair.branching.restores > 0,
                'Positive matrix workload did not exercise branching; review its size after CI calibration'
            );
        }
    }
    assert.equal(environment.provider, 'github-actions');
    assert.equal(environment.runner, policy.runner);
    assert.ok(environment.cpu && environment.browser && environment.workloadDigest);
    assert.match(provenance.commit, /^[a-f0-9]{40}$/);
    assert.match(provenance.runUrl, /^https:\/\/github.com\/MageLens\/MageLens\/actions\/runs\/\d+$/);
    assert.ok(Number.isSafeInteger(provenance.attempt) && provenance.attempt > 0);
    const medians = Object.fromEntries(
        ['linear', 'branching'].map((arm) => [
            arm,
            Object.fromEntries(
                ['setupMs', 'testsMs', 'totalMs'].map((metric) => [
                    metric,
                    median(pairs.map((pair) => pair[arm][metric]))
                ])
            )
        ])
    );
    const candidate = {
        row,
        environment,
        provenance,
        pairs: pairs.length,
        medians,
        checkpoints: pairs.map((pair) => pair.branching.checkpoints),
        restores: pairs.map((pair) => pair.branching.restores)
    };
    const result = {
        schemaVersion: 1,
        row,
        status: 'passed',
        referenceCandidate: candidate,
        regressions: [],
        improvements: [],
        matrixRefreshRequired: false
    };
    if (!reference || JSON.stringify(reference.environment) !== JSON.stringify(environment)) {
        result.status = 'baseline-required';
        result.matrixRefreshRequired = true;
        return result;
    }
    assert.equal(reference.pairs, policy.pairs, 'Reference lacks complete CI pairs');
    assert.match(reference.provenance?.commit ?? '', /^[a-f0-9]{40}$/);
    assert.match(
        reference.provenance?.runUrl ?? '',
        /^https:\/\/github.com\/MageLens\/MageLens\/actions\/runs\/\d+$/
    );
    for (const arm of ['linear', 'branching'])
        for (const metric of ['setupMs', 'testsMs', 'totalMs']) {
            const previous = reference.medians?.[arm]?.[metric],
                observed = medians[arm][metric];
            assert.ok(Number.isFinite(previous) && previous > 0, 'Invalid CI reference timing');
            const change = {
                arm,
                metric,
                referenceMs: previous,
                observedMs: observed,
                fraction: observed / previous - 1
            };
            if (observed - previous >= policy.minimumChangeMs && change.fraction > policy.regressionFraction)
                result.regressions.push(change);
            if (
                previous - observed >= policy.minimumChangeMs &&
                -change.fraction > policy.improvementFraction
            )
                result.improvements.push(change);
        }
    // Checkpoint choices can legitimately change after CI calibration. Preserve
    // that evidence and ask for matrix review instead of forcing old selections.
    if (
        JSON.stringify(candidate.checkpoints) !== JSON.stringify(reference.checkpoints) ||
        result.improvements.length
    )
        result.matrixRefreshRequired = true;
    if (result.regressions.length) result.status = 'regression';
    return result;
}
function main() {
    const [campaign, row, output] = process.argv.slice(2);
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'CI references require GitHub Actions');
    assert.equal(references.schemaVersion, 2);
    assert.equal(references.environment, 'github-actions');
    const pairs = JSON.parse(fs.readFileSync(path.join(campaign, 'pairs.json')));
    const environment = {
        provider: 'github-actions',
        runner: policy.runner,
        architecture: process.arch,
        cpu: require('node:os').cpus()[0].model,
        cpus: require('node:os').cpus().length,
        imageOS: process.env.ImageOS,
        browser: pairs[0]?.linear.browser,
        workloadDigest: workloadDigest(),
        dependenciesDigest: createHash('sha256').update(fs.readFileSync('dependencies.yaml')).digest('hex')
    };
    const provenance = {
        commit: process.env.GITHUB_SHA,
        runUrl: `https://github.com/MageLens/MageLens/actions/runs/${process.env.GITHUB_RUN_ID}`,
        attempt: Number(process.env.GITHUB_RUN_ATTEMPT)
    };
    const result = assess(
        row,
        pairs,
        environment,
        provenance,
        references.rows.find((item) => item.row === row)
    );
    fs.mkdirSync(output, {recursive: true});
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    const summary = `Branching performance ${row}: ${result.status}. Matrix refresh required: ${result.matrixRefreshRequired}.\n`;
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    if (result.matrixRefreshRequired)
        console.log(
            `::warning::${row}: review the CI reference candidate and rebuild the complete performance matrix.`
        );
    if (result.status !== 'passed') throw new Error(summary);
}
module.exports = {assess, workloadDigest};
if (require.main === module) main();
