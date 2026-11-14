// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {createHash, randomUUID} = require('node:crypto');
const {digest, fileDigest} = require('../identity.cjs');
const ledger = require('./campaign-ledger.cjs');
const {PLAYWRIGHT_TEST_TIMING_BOUNDARY} = require('./prefix-measurement.cjs');

function observationsMatch(forecasts, samples, tests, manifest, boundary) {
    if (!Array.isArray(forecasts) || !Array.isArray(samples) || !tests.length ||
        forecasts.length !== tests.length || samples.length !== tests.length) return false;
    const ids = new Set(tests.map(test=>test.id));
    const seen = new Set();
    return forecasts.every(({id,snapshot}, index) => {
        const sample = samples[index];
        if (!ids.delete(id) || typeof snapshot?.observationId !== 'string' || seen.has(snapshot.observationId) ||
            sample?.eligible !== true || !Number.isFinite(sample.actualMs) || sample.actualMs <= 0 ||
            sample.modelId !== manifest.candidateDigest || sample.featureSchema !== manifest.featureSchema ||
            sample.timingBoundary !== boundary) return false;
        seen.add(snapshot.observationId);
        const observedInputs = Object.fromEntries(Object.keys(snapshot).map(key=>[key,sample[key]]));
        return digest(snapshot) === digest(observedInputs);
    });
}

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
    function append(status, details, nextAction, measuredResources = resources()) {
        ledger.append(workspace, cycle, {
            id: `${id}-${status}`, state:'collecting', startedAt,
            finishedAt:new Date().toISOString(), elapsedMs:performance.now()-started,
            resources:measuredResources, nextAction,
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
    const measuredResources = resources();
    let collectionStatus;
    if (report.exitCode !== 0 || report.status !== 'passed' || report.errors.length) {
        append('failed', {reason:'Native Playwright result failed'}, 'Inspect the native result', measuredResources);
        collectionStatus = 'failed';
    } else if (measuredResources.peakMemoryBytes > manifest.budget.maxMemoryBytes ||
        measuredResources.diskBytes > manifest.budget.maxDiskBytes) {
        append('quarantined', {reason:'Run exceeded the frozen memory or disk budget'}, 'Inspect resource measurements', measuredResources);
        collectionStatus = 'quarantined';
    } else {
        let reason, observationDigest;
        try {
            const forecastBytes = artifacts?.forecasts && fs.readFileSync(artifacts.forecasts);
            if (!artifacts?.observations || !forecastBytes ||
                createHash('sha256').update(forecastBytes).digest('hex') !== snapshotDigest)
                reason = 'Missing observation or changed frozen forecast';
            else {
                const bytes = fs.readFileSync(artifacts.observations);
                const samples = JSON.parse(bytes);
                if (!observationsMatch(JSON.parse(forecastBytes), samples, report.tests, manifest, entry.timingBoundary))
                    reason = 'Native observation did not pass the frozen profile checks';
                else observationDigest = createHash('sha256').update(bytes).digest('hex');
            }
        } catch {
            reason = 'Native timing artifacts are unreadable or malformed';
        }
        collectionStatus = reason ? 'quarantined' : 'passed';
        if (reason) append('quarantined', {reason}, 'Audit the rejected observation', measuredResources);
        else append('passed', {observationDigest}, 'Continue the frozen run order', measuredResources);
    }
    return {...report, collectionStatus};
}

module.exports = {collect};
