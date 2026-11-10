// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Explicit estimates for synthetic execution fixtures; source analysis itself
// is exercised by the Rust CLI and cross-entry-point regression tests.
function estimate(points = 0) {
    return {points, estimatedPoints: points, lowerBoundPoints: points, upperBoundPoints: points,
        analysisComplete: true, complete: true, issues: [], reasons: [], operations: {}, estimatedOperations: {}};
}
function assessed(manifest) {
    for (const test of manifest.tests) {
        for (const key of ['fixtureEstimate', 'workerEstimate', 'lifecycleEstimate', 'estimate']) test[key] ??= estimate();
        for (const step of test.steps) step.estimate ??= estimate(step.actionUnits ?? 0);
    }
    const total = manifest.tests.reduce((sum, test) => sum + test.steps.length, 0);
    manifest.implementation = 'rust-prefix-v2';
    manifest.assessment = {version: 'js-ts-points-v4', boundsVersion: 1, analysis: {status: 'complete', totalStatements: total,
        analyzedStatements: total, collectionComplete: true, collectionDiagnostics: 0, fixturesWithGaps: 0, workersWithGaps: 0, lifecycleWithGaps: 0}};
    return manifest;
}
module.exports = {assessed, estimate};
