// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const {fileDigest} = require('../identity.cjs');
const ledger = require('./campaign-ledger.cjs');
const {PLAYWRIGHT_TEST_TIMING_BOUNDARY} = require('./prefix-measurement.cjs');

async function collect({workspace, cycle, lease, caseId, configuration, directory, profile, resources,
    runner = require('../runners/playwright/native.cjs')}) {
    const {manifest} = ledger.read(workspace, cycle);
    const entry = manifest.inventory.find(item => item.id === caseId);
    if (entry?.disposition !== 'scheduled' || entry.runner !== 'playwright' ||
        entry.timingBoundary !== PLAYWRIGHT_TEST_TIMING_BOUNDARY) throw new Error('Playwright test is outside the frozen campaign');
    if (!profile.model || fileDigest(profile.model) !== manifest.candidateDigest)
        throw new Error('Playwright profile does not match the frozen candidate');

    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let snapshotDigest;
    function append(status, details, nextAction) {
        ledger.append(workspace, cycle, {
            id: `${id}-${status}`, state:'collecting', startedAt,
            finishedAt:new Date().toISOString(), elapsedMs:performance.now()-started,
            resources:resources(), nextAction,
            attempt:{id, caseId, status, snapshotDigest, ...details}
        }, lease);
    }

    let report;
    try {
        report = await runner.run(configuration, directory, {
            profile:{...profile, modelDigest:manifest.candidateDigest, featureSchema:manifest.featureSchema},
            onPrepared({forecastDigest}) {
                snapshotDigest = forecastDigest;
                append('started', {}, 'Run the frozen Playwright selection');
            }
        });
    } catch (error) {
        if (snapshotDigest && ledger.read(workspace, cycle).records.some(record => record.event.attempt?.id === id))
            append('failed', {reason:'Native Playwright invocation failed'}, 'Inspect the native runner failure');
        throw error;
    }
    const artifacts = report.profileArtifacts;
    if (!snapshotDigest) throw new Error('Native Playwright run did not record a frozen forecast');
    if (report.exitCode !== 0 || report.status !== 'passed' || report.errors.length) {
        append('failed', {reason:'Native Playwright result failed'}, 'Inspect the native result');
    } else if (!artifacts?.observations || !fs.existsSync(artifacts.observations) ||
        !fs.existsSync(artifacts.forecasts) || fileDigest(artifacts.forecasts) !== snapshotDigest) {
        append('quarantined', {reason:'Missing observation or changed frozen forecast'}, 'Audit the native timing artifacts');
    } else {
        const samples = JSON.parse(fs.readFileSync(artifacts.observations, 'utf8'));
        if (!samples.length || samples.length !== report.tests.length ||
            samples.some(sample => !sample.eligible || sample.modelId !== manifest.candidateDigest ||
                sample.featureSchema !== manifest.featureSchema || sample.timingBoundary !== entry.timingBoundary))
            append('quarantined', {reason:'Native observation did not pass the frozen profile checks'}, 'Audit the rejected observation');
        else append('passed', {observationDigest:fileDigest(artifacts.observations)}, 'Continue the frozen run order');
    }
    return report;
}

module.exports = {collect};
