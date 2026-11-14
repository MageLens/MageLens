// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.


const SEGMENT_TIMING_BOUNDARY = 'checkpoint-segment-run-duration/v1';
const PREFIX_TIMING_BOUNDARY = 'checkpoint-prefix/v1';
const PLAYWRIGHT_TEST_TIMING_BOUNDARY = 'playwright-test-result-duration/v1';
const TEST_TIMING_BOUNDARY = 'cypress-test-duration-minus-preparation/v2';
const {digest} = require('../identity.cjs');

function observeExecutedSegment(snapshot, segment, audit) {
    const timing = segment?.prefixTiming;
    if (typeof segment?.id !== 'string' || !segment.id || !timing || timing.timingBoundary !== SEGMENT_TIMING_BOUNDARY ||
        snapshot.timingBoundary !== timing.timingBoundary || snapshot.unit !== 'prefix' ||
        timing.forecast?.digest !== digest(snapshot) || snapshot.segment?.fromDepth !== timing.fromDepth ||
        snapshot.segment?.toDepth !== timing.toDepth) {
        throw new Error('Segment has no matching frozen prefix forecast');
    }
    const workPassed = segment.status === 'passed' && timing.workCompleted === true;
    const observation = recordPrefixObservation(snapshot, {
        timingBoundary:timing.timingBoundary,
        prefixWorkMs:timing.workMs,
        wallTimeMs:segment.wallMs
    }, {
        kind:timing.kind,
        fromDepth:timing.fromDepth,
        toDepth:timing.toDepth,
        passed:workPassed,
        attempts:audit?.attempts ?? 0,
        sourceDigest:audit?.sourceDigest ?? ''
    });
    if (audit?.passed !== true) {
        if (workPassed) observation.exclusion = 'Provider or suite audit failed';
        observation.eligible = false;
    }
    return {...observation, measurementKind: 'retained-provider-segment',
        forecastDigest: timing.forecast.digest,
        observationId:digest([timing.forecast.digest,segment.id]),executionSegmentId:segment.id};
}

function validatePrefixMeasurement(observation) {
    const issues = [];
    if (!observation || typeof observation !== 'object') {
        return {valid: false, issues: ['Invalid prefix observation object']};
    }
    if (observation.unit !== 'prefix') {
        issues.push(`Expected unit 'prefix', got '${observation.unit}'`);
    }
    if (![PREFIX_TIMING_BOUNDARY,SEGMENT_TIMING_BOUNDARY].includes(observation.timingBoundary)) {
        issues.push(`Expected timingBoundary '${PREFIX_TIMING_BOUNDARY}', got '${observation.timingBoundary}'`);
    }
    if (!Number.isFinite(observation.actualMs) || observation.actualMs <= 0) {
        issues.push(`Invalid actualMs: ${observation.actualMs}; prefix workload duration must be positive`);
    }

    const timings = observation.timings ?? {};
    for (const field of ['preparationMs','checkpointCaptureMs','checkpointRestoreMs','resetMs','wallTimeMs']) {
        if (timings[field] !== undefined && (!Number.isFinite(timings[field]) || timings[field] < 0))
            issues.push(`${field} must be finite and nonnegative`);
    }
    if (Number.isFinite(timings.wallTimeMs) && timings.wallTimeMs < observation.actualMs)
        issues.push('Wall time cannot be shorter than measured work');

    const seg = observation.segment ?? {};
    if (seg.toDepth !== undefined && seg.fromDepth !== undefined) {
        const fixtureOnly = observation.timingBoundary === SEGMENT_TIMING_BOUNDARY && seg.kind === 'fixture' &&
            seg.fromDepth === 0 && seg.toDepth === 0;
        if (!fixtureOnly && seg.fromDepth >= seg.toDepth) {
            issues.push(`fromDepth (${seg.fromDepth}) must be strictly less than toDepth (${seg.toDepth})`);
        }
    }

    return {
        valid: issues.length === 0,
        issues
    };
}

function recordPrefixObservation(snapshot, timings, options = {}) {
    const {
        prefixWorkMs,
        preparationMs = 0,
        checkpointCaptureMs = 0,
        checkpointRestoreMs = 0,
        resetMs = 0,
        wallTimeMs = prefixWorkMs
    } = timings;

    const fromDepth = options.fromDepth ?? 0;
    const toDepth = options.toDepth ?? 1;
    const passed = options.passed ?? true;
    const attempts = options.attempts ?? 1;
    const sourceDigest = options.sourceDigest ?? snapshot.sourceDigest;
    const sourcesUnchanged = sourceDigest === snapshot.sourceDigest;

    const measurementBoundary = timings.timingBoundary ?? PREFIX_TIMING_BOUNDARY;
    const matchingBoundary = snapshot.unit === 'prefix' &&
        snapshot.timingBoundary === measurementBoundary && [PREFIX_TIMING_BOUNDARY,SEGMENT_TIMING_BOUNDARY].includes(measurementBoundary);
    const eligible = matchingBoundary && passed === true && attempts === 1 && sourcesUnchanged &&
        Number.isFinite(prefixWorkMs) && prefixWorkMs > 0;
    let exclusion = null;
    if (!eligible) {
        if (!matchingBoundary) exclusion = 'Forecast and measurement require the same supported prefix timing boundary';
        else if (passed !== true) exclusion = 'Test or prefix step execution failed';
        else if (attempts > 1) exclusion = 'Retried attempt';
        else if (!sourcesUnchanged) exclusion = 'Source changed during execution';
        else exclusion = 'Invalid prefix timing measurement';
    }

    const observation = {
        ...snapshot,
        unit: 'prefix',
        timingBoundary: measurementBoundary,
        actualMs: prefixWorkMs,
        observedAt: new Date().toISOString(),
        eligible,
        exclusion,
        errorMs: matchingBoundary && snapshot.prediction ? snapshot.prediction.ms - prefixWorkMs : null,
        segment: {
            fromDepth,
            toDepth,
            ...(measurementBoundary === SEGMENT_TIMING_BOUNDARY ? {kind:options.kind ?? 'steps'} : {}),
            isIncremental: fromDepth > 0,
            hasFixtureSetup: measurementBoundary === SEGMENT_TIMING_BOUNDARY ? options.kind === 'fixture' : fromDepth === 0
        },
        timings: {
            prefixWorkMs,
            preparationMs,
            checkpointCaptureMs,
            checkpointRestoreMs,
            resetMs,
            checkpointOverheadMs: checkpointCaptureMs + checkpointRestoreMs + resetMs,
            wallTimeMs
        }
    };

    const validation = validatePrefixMeasurement(observation);
    if (!validation.valid && matchingBoundary) {
        observation.eligible = false;
        observation.exclusion = `Validation failure: ${validation.issues.join('; ')}`;
    }

    return observation;
}

function evaluateCheckpointDecisions(rows, defaultOverhead = {}) {
    const defaultCapture = defaultOverhead.checkpointCaptureMs ?? 5000;
    const defaultRestore = defaultOverhead.checkpointRestoreMs ?? 1500;

    let truePositives = 0;
    let trueNegatives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let uncertainCount = 0;
    let ineligibleCount = 0;
    let totalRealizedSavingsMs = 0;
    let totalMissedSavingsMs = 0;
    let totalSlowdownMs = 0;

    const evaluations = [];

    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const actualWorkMs = row.actualMs ?? row.timings?.prefixWorkMs;
        const predictedWorkMs = row.prediction?.ms;
        const lowerMs = row.prediction?.lowerMs ?? predictedWorkMs;
        const upperMs = row.prediction?.upperMs ?? predictedWorkMs;
        const consumers = Math.max(2, row.consumers ?? 2);
        const captureMs = row.timings?.checkpointCaptureMs ?? defaultCapture;
        const restoreMs = row.timings?.checkpointRestoreMs ?? defaultRestore;

        // Break-even threshold: (captureMs + (consumers - 1) * restoreMs) / (consumers - 1)
        const breakEvenMs = (captureMs + (consumers - 1) * restoreMs) / (consumers - 1);

        // Restoration eligibility check (e.g. deterministic restoration, no unrestoreable state)
        const restorationEligible = row.restorationEligible !== false;
        if (!restorationEligible) {
            ineligibleCount++;
        }

        const predictedProfitable = restorationEligible && predictedWorkMs !== undefined && predictedWorkMs > breakEvenMs;
        const actualProfitable = restorationEligible && actualWorkMs !== undefined && actualWorkMs > breakEvenMs;

        // Uncertainty: threshold falls within prediction confidence bounds [lowerMs, upperMs]
        const isUncertain = lowerMs !== undefined && upperMs !== undefined && breakEvenMs >= lowerMs && breakEvenMs <= upperMs;
        if (isUncertain) {
            uncertainCount++;
        }

        let outcome;
        if (!restorationEligible) {
            outcome = 'ineligible_restoration';
        } else if (predictedProfitable && actualProfitable) {
            outcome = 'true_positive';
            truePositives++;
            const savings = (consumers - 1) * actualWorkMs - (captureMs + (consumers - 1) * restoreMs);
            totalRealizedSavingsMs += Math.max(0, savings);
        } else if (!predictedProfitable && !actualProfitable) {
            outcome = 'true_negative';
            trueNegatives++;
        } else if (predictedProfitable && !actualProfitable) {
            outcome = 'false_positive';
            falsePositives++;
            const penalty = (captureMs + (consumers - 1) * restoreMs) - (consumers - 1) * actualWorkMs;
            totalSlowdownMs += Math.max(0, penalty);
        } else {
            outcome = 'false_negative'; // Missed savings
            falseNegatives++;
            const missed = (consumers - 1) * actualWorkMs - (captureMs + (consumers - 1) * restoreMs);
            totalMissedSavingsMs += Math.max(0, missed);
        }

        evaluations.push({
            id: row.id,
            consumers,
            breakEvenMs,
            predictedWorkMs,
            actualWorkMs,
            restorationEligible,
            predictedProfitable,
            actualProfitable,
            uncertain: isUncertain,
            outcome
        });
    }

    return {
        status: 'measured',
        total: evaluations.length,
        truePositives,
        trueNegatives,
        falsePositives,
        falseNegatives,
        uncertainCount,
        ineligibleCount,
        totalRealizedSavingsMs,
        totalSlowdownMs,
        totalMissedSavingsMs,
        netDurationDeltaMs: totalRealizedSavingsMs - totalSlowdownMs,
        evaluations
    };
}

module.exports = {
    SEGMENT_TIMING_BOUNDARY,
    PREFIX_TIMING_BOUNDARY,
    TEST_TIMING_BOUNDARY,
    PLAYWRIGHT_TEST_TIMING_BOUNDARY,
    validatePrefixMeasurement,
    recordPrefixObservation,
    observeExecutedSegment,
    evaluateCheckpointDecisions
};
