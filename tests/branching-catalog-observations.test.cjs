// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const {digest} = require('../branching/identity.cjs');
const {catalogObservations} = require('../branching/predictor/catalog-observations.cjs');
const {SEGMENT_TIMING_BOUNDARY} = require('../branching/predictor/prefix-measurement.cjs');

function evidence() {
    const snapshot = {unit:'prefix', timingBoundary:SEGMENT_TIMING_BOUNDARY, modelId:'frozen-model',
        sourceDigest:'source', environmentDigest:'environment', group:'development-family',
        segment:{fromDepth:2,toDepth:162}, prediction:{ms:3500}};
    return {
        candidateId:'catalog',
        manifest:{sourceDigest:'suite-source', tests:[{},{}], assessment:{stages:{catalog:{trainingSnapshot:snapshot}}}},
        report:{kind:'catalog-qualification-measurement', run:'collection', status:'passed', errors:[],
            runtimeContext:{before:{phpfpm:{memoryBytes:2147483648}},after:{phpfpm:{memoryBytes:2147483648}}},
            cleanupVerified:true, sourceIntegrity:{verified:true,digest:'suite-source'},
            providerDiagnostics:{retainedServices:{schemasRemoved:true,grantsRestored:true}},
            counts:{fallbacks:0,failures:0,blockedSpecs:0}, wallMs:120000,
            native:{coverageFinalized:true,coverageRunId:'coverage',totalTests:2,totalPassed:2},
            calibration:{requestedSamples:2,samples:[0,1].map(i => ({stage:'sample-'+i,status:'passed',
                runtimeContext:{phpfpm:{memoryBytes:2147483648}},
                segment:{forecastDigest:digest(snapshot),workMs:41000+i}}))}},
        coverageResult:{run:'coverage',runner:'playwright',status:'passed',maxAttempts:1,
            totalTests:2,totalPassed:2,totalFailed:0,totalPending:0,totalSkipped:0,
            tests:[{status:'passed'},{status:'passed'}],browser:{name:'chrome',version:'157.0.8103.38'}},
        coverageSummary:{run:'coverage'}
    };
}

test('catalog collection retains the frozen forecast, group and incremental timing contract', () => {
    const input = evidence();
    const rows = catalogObservations(input);
    assert.deepEqual(rows.map(row => row.actualMs), [41000,41001]);
    assert.ok(rows.every(row => row.eligible && row.group === 'development-family'));
    assert.ok(rows.every(row => row.prediction.ms === 3500 && row.segment.fromDepth === 2));
    assert.notEqual(rows[0].observationId, rows[1].observationId);
    assert.equal(rows[0].collectionEvidenceDigest, rows[1].collectionEvidenceDigest);
});

test('incomplete, retried, mismatched or failed catalog collection cannot supply labels', () => {
    for (const mutate of [
        x => delete x.report.cleanupVerified,
        x => delete x.report.runtimeContext,
        x => x.report.runtimeContext.after.phpfpm.memoryBytes = 0,
        x => x.report.calibration.samples[0].runtimeContext.phpfpm.memoryBytes = 0,
        x => delete x.report.native.coverageFinalized,
        x => x.report.providerDiagnostics.retainedServices.schemasRemoved = false,
        x => x.report.providerDiagnostics.retainedServices.grantsRestored = false,
        x => x.report.counts.fallbacks++,
        x => x.report.sourceIntegrity.digest = 'changed',
        x => x.report.calibration.samples.pop(),
        x => x.report.calibration.samples[1].stage = 'sample-0',
        x => x.report.calibration.samples[0].segment.forecastDigest = 'changed',
        x => x.report.calibration.samples[0].segment.workMs = NaN,
        x => x.report.calibration.samples[0].status = 'failed',
        x => x.coverageResult.maxAttempts++,
        x => x.coverageResult.totalSkipped++,
        x => x.coverageResult.totalTests--,
        x => x.coverageResult.tests[0].status = 'failed',
        x => x.coverageResult.run = 'stale',
        x => x.coverageSummary.run = 'stale'
    ]) {
        const input = evidence();
        mutate(input);
        assert.throws(() => catalogObservations(input), undefined, mutate.toString());
    }
});
