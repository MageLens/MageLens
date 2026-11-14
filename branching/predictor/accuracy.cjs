// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const ACCURACY_CONTRACT = 'duration-within-five-percent/v1';
const TARGET_PERCENT = 5;
const REQUIRED_RATE = 0.95;
const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(q * values.length) - 1)] ?? null;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function accuracyMetrics(rows, {raw = false} = {}) {
    const measured = rows.filter(row => row.eligible === true);
    if (measured.some(row => !Number.isFinite(row.actualMs) || row.actualMs <= 0)) {
        throw new Error('Eligible accuracy observations require positive finite actual durations');
    }
    const errors = [], intervals = [];
    let warnings = 0;
    for (const row of measured) {
        const forecast = row.prediction;
        const predicted = raw ? forecast?.rawMs : forecast?.ms;
        if (!Number.isFinite(predicted) || predicted <= 0) continue;
        const signed = predicted - row.actualMs;
        errors.push({signed, percent: signed / row.actualMs * 100});
        const lower = raw ? forecast.rawLowerMs : forecast.lowerMs;
        const upper = raw ? forecast.rawUpperMs : forecast.upperMs;
        if (Number.isFinite(lower) && Number.isFinite(upper) && lower >= 0 && upper >= lower) {
            intervals.push(row.actualMs >= lower && row.actualMs <= upper ? 1 : 0);
        }
        if (forecast.outOfRange || forecast.environmentKnown === false || forecast.domainMatched === false) warnings++;
    }
    const within = errors.filter(error => Math.abs(error.percent) <= TARGET_PERCENT).length;
    const rate = measured.length ? within / measured.length : null;
    return {
        contract: ACCURACY_CONTRACT, targetPercent: TARGET_PERCENT, requiredWithinRate: REQUIRED_RATE,
        eligible: measured.length, samples: errors.length, unpredicted: measured.length - errors.length,
        withinTarget: within, misses: measured.length - within, withinTargetRate: rate,
        missRate: measured.length ? (measured.length - within) / measured.length : null,
        meetsErrorTarget: rate !== null && rate >= REQUIRED_RATE,
        meanAbsoluteErrorMs: mean(errors.map(error => Math.abs(error.signed))),
        biasMs: mean(errors.map(error => error.signed)),
        signedBiasPercent: mean(errors.map(error => error.percent)),
        medianAbsolutePercentError: percentile(errors.map(error => Math.abs(error.percent)), .5),
        p90AbsolutePercentError: percentile(errors.map(error => Math.abs(error.percent)), .9),
        p95AbsolutePercentError: percentile(errors.map(error => Math.abs(error.percent)), .95),
        intervalSamples: intervals.length, intervalCoverage: mean(intervals),
        domainWarningSamples: warnings
    };
}

function accuracyStrata(rows) {
    const result = {};
    for (const dimension of ['runner', 'unit', 'timingBoundary', 'sourceFamily', 'workloadFamily', 'environmentDigest']) {
        const groups = new Map();
        for (const row of rows.filter(row => row.eligible === true)) {
            const value = typeof row[dimension] === 'string' && row[dimension] ? row[dimension] : '<unspecified>';
            if (!groups.has(value)) groups.set(value, []);
            groups.get(value).push(row);
        }
        result[dimension] = Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b))
            .map(([key, items]) => [key, accuracyMetrics(items)]));
    }
    return result;
}
module.exports = {ACCURACY_CONTRACT, TARGET_PERCENT, REQUIRED_RATE, accuracyMetrics, accuracyStrata};
