// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const {accuracyMetrics, accuracyStrata} = require('../branching/predictor/accuracy.cjs');
const row = (ms = 100, extra = {}) => ({eligible: true, actualMs: 100, prediction: {ms}, ...extra});

test('strict accuracy uses all eligible labels and includes missing and invalid forecasts as misses', () => {
    const rows = [...Array.from({length: 19}, () => row(105)), row(null)];
    const score = accuracyMetrics(rows);
    assert.equal(score.withinTarget, 19);
    assert.equal(score.misses, 1);
    assert.equal(score.unpredicted, 1);
    assert.equal(score.withinTargetRate, .95);
    assert.equal(score.meetsErrorTarget, true);
    assert.equal(accuracyMetrics([...rows, row(NaN)]).meetsErrorTarget, false);
    for (const invalid of [null, 0, -1, Infinity, NaN, '100']) {
        assert.equal(accuracyMetrics([row(invalid)]).misses, 1);
    }
    assert.equal(accuracyMetrics([row(105.00001)]).withinTarget, 0);
    assert.equal(accuracyMetrics([]).meetsErrorTarget, false);
});

test('metrics recompute signed errors without duration floors or clipping and use nearest-rank P95', () => {
    const values = Array.from({length: 20}, (_, index) => row(100 + index, {errorMs: 0}));
    const score = accuracyMetrics(values);
    assert.equal(score.p95AbsolutePercentError, 18);
    assert.equal(score.p90AbsolutePercentError, 17);
    assert.equal(score.medianAbsolutePercentError, 9);
    assert.equal(score.signedBiasPercent, 9.5);
    assert.equal(accuracyMetrics([row(1, {actualMs: .01})]).p95AbsolutePercentError, 9900);
    assert.equal(accuracyMetrics([row(90)]).signedBiasPercent, -10);
    assert.throws(() => accuracyMetrics([row(100, {actualMs: 0})]), /positive finite/);
});

test('failed measurements stay excluded while missing forecasts remain in every declared stratum', () => {
    const rows = [row(100, {runner: 'cypress'}), row(null, {runner: 'playwright'}), row(1, {eligible: false})];
    const score = accuracyMetrics(rows), strata = accuracyStrata(rows);
    assert.equal(score.eligible, 2);
    assert.equal(score.withinTargetRate, .5);
    assert.equal(strata.runner.playwright.unpredicted, 1);
    assert.equal(strata.runner.playwright.meetsErrorTarget, false);
    assert.equal(strata.timingBoundary['<unspecified>'].eligible, 2);
});

test('raw and calibrated scores use their own predictions and interval availability is explicit', () => {
    const rows = [row(100, {prediction: {ms: 100, rawMs: 150, lowerMs: 95, upperMs: 105, outOfRange: true}}), row(110)];
    assert.equal(accuracyMetrics(rows).intervalSamples, 1);
    assert.equal(accuracyMetrics(rows).intervalCoverage, 1);
    assert.equal(accuracyMetrics(rows).domainWarningSamples, 1);
    const raw = accuracyMetrics(rows, {raw: true});
    assert.equal(raw.p95AbsolutePercentError, 50);
    assert.equal(raw.unpredicted, 1);
    assert.equal(raw.intervalCoverage, null);
});

test('training and native metrics agree on short durations, missing forecasts and nearest-rank tails', () => {
    const {execFileSync} = require('node:child_process');
    const path = require('node:path');
    const cases = [[], [row(null)], [...Array.from({length: 19}, () => row(105)), row(null)],
        [row(1, {actualMs: .01}), row(90), row(100), row(106)]];
    const script = `import json,sys\nsys.path.insert(0, sys.argv[1])\nfrom accuracy import metrics\ncases=json.load(sys.stdin)\nprint(json.dumps([metrics([r['actualMs'] for r in rows],[r['prediction']['ms'] for r in rows]) for rows in cases],allow_nan=False))`;
    const python = JSON.parse(execFileSync('python3', ['-c', script, path.resolve(__dirname, '../branching/predictor')],
        {input: JSON.stringify(cases), encoding: 'utf8'}));
    for (const [index, rows] of cases.entries()) {
        const native = accuracyMetrics(rows);
        for (const [key, expected] of Object.entries(python[index])) assert.equal(native[key], expected, key);
    }
});

test('public evaluation keeps unpredicted domains visible and never treats diagnostics as qualification', () => {
    const {evaluate} = require('../branching/predictor/index.cjs');
    const result = evaluate([...Array.from({length: 99}, () => row(100, {runner: 'cypress', unit: 'test', sourceFamily: 'a'})),
        row(null, {runner: 'playwright', unit: 'test', sourceFamily: 'b'})]);
    assert.equal(result.withinTargetRate, .99);
    assert.equal(result.meetsErrorTarget, false);
    assert.equal(result.groups['playwright/test/b'].misses, 1);
    assert.match(result.qualification, /diagnostic-only/);
    assert.equal(result.status, 'incomplete');
});
