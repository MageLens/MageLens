// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {comparePair, median} = require('./analyze.cjs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function percentile(values, fraction) {
    const ordered = [...values].sort((a,b) => a-b);
    assert.ok(ordered.length && ordered.every(value => Number.isFinite(value) && value >= 0));
    return ordered[Math.max(0, Math.ceil(ordered.length*fraction)-1)];
}
function describe(values) {
    return values.length ? {samples:values.length, min:Math.min(...values), median:median(values),
        p90:percentile(values,.9), max:Math.max(...values)} : null;
}
function calibrate(campaigns) {
    const operations = {capture:[], restore:[], release:[], firstReset:[], laterReset:[], backend:[]};
    const prefixes = [], rows = [];
    for (const campaign of campaigns) for (const pair of read(path.join(campaign, 'pairs.json'))) {
        comparePair(pair.linear, pair.branching);
        const directory = path.join(campaign, `${pair.row}-${pair.pair}-branching`);
        const report = read(path.join(directory, 'report.json'));
        const manifest = read(path.join(directory, 'manifest.json'));
        const native = path.join(campaign, `${pair.row}-${pair.pair}-linear`, 'steps');
        const steps = fs.readdirSync(native).flatMap(name => read(path.join(native, name)));
        for (const {report: phase} of report.phases.filter(phase => phase.kind === 'checkpoint')) {
            assert.equal(phase.status, 'passed');
            assert.equal(phase.counts.fallbacks, 0);
            assert.equal(phase.checkpoints.length, phase.releases.length);
            for (const [metric, field] of [['capture','captures'], ['restore','restores'], ['release','releases']])
                operations[metric].push(...phase.costs[field].map(item => item.ms));
            operations.firstReset.push(phase.costs.resets[0]);
            operations.laterReset.push(...phase.costs.resets.slice(1));
            operations.backend.push(phase.phases.prepare + phase.phases.cleanup);
            for (const checkpoint of manifest.checkpoints.filter(cp => phase.checkpointPolicy.selected.includes(cp.id))) {
                for (const id of checkpoint.consumers) {
                    const test = manifest.tests.find(test => test.id === id);
                    const source = test.steps.slice(0, checkpoint.depth);
                    assert.ok(source.length && source.every(step => step.estimate.complete));
                    const first = source[0].line, last = source.at(-1).line;
                    const matches = steps.filter(step => step.test === test.title && step.line >= first && step.line <= last &&
                        path.basename(step.file) === path.basename(test.file));
                    assert.ok(matches.length && matches.every(step => !step.failed), 'Missing successful native prefix measurements');
                    const ms = matches.reduce((sum, step) => sum + step.ms, 0);
                    const points = source.reduce((sum, step) => sum + step.estimate.lowerBoundPoints, 0);
                    assert.ok(points > 0 && ms > 0);
                    prefixes.push({campaign:path.basename(campaign), row:pair.row, pair:pair.pair, test:test.title,
                        checkpoint:checkpoint.id, points, ms, millisecondsPerPoint:ms/points});
                }
            }
        }
        rows.push({campaign:path.basename(campaign), row:pair.row, pair:pair.pair, testsSpeedup:pair.testsSpeedup});
    }
    const measurements = Object.fromEntries(Object.entries(operations).map(([key,values]) => [key,describe(values)]));
    assert.ok(measurements.capture && measurements.restore && prefixes.length, 'Calibration needs successful checkpoint execution');
    const round = value => Math.ceil(value/100)*100;
    return {schemaVersion:1, units:'milliseconds', measurements, prefixes, rows,
        millisecondsPerPoint:describe(prefixes.map(prefix => prefix.millisecondsPerPoint)),
        proposal:{unitMs:Math.max(1,Math.floor(percentile(prefixes.map(prefix => prefix.millisecondsPerPoint),.1)/5)*5),
            captureMs:round(measurements.capture.p90), restoreMs:round(measurements.restore.p90),
            releaseMs:Math.ceil(measurements.release.p90), firstResetMs:round(measurements.firstReset.p90),
            backendMs:round(measurements.backend.p90),
            resetMs:measurements.laterReset?round(measurements.laterReset.p90):null,
            overheadMultiplier:2, overheadMargin:.20, minSavingMs:50},
        policy:'Proposal only. No configuration is changed. Unknown later-reset cost must retain a measured conservative default. Validate frozen constants on separate matrix runs.'};
}
if (require.main === module) console.log(JSON.stringify(calibrate(process.argv.slice(2)), null, 2));
module.exports = {calibrate, describe, percentile};
