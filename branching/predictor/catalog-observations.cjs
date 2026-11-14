// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {digest} = require('../identity.cjs');
const {observeExecutedSegment, SEGMENT_TIMING_BOUNDARY} = require('./prefix-measurement.cjs');

function catalogRuntimeContext(backend) {
    const inspect = id => JSON.parse(require('../command.cjs').command('docker', ['inspect', id]))[0];
    const resources = container => {
        const {Memory, MemorySwap, NanoCpus, CpuPeriod, CpuQuota, CpusetCpus, ShmSize} = container.HostConfig;
        return {image:container.Image, memoryBytes:Memory, memorySwapBytes:MemorySwap, nanoCpus:NanoCpus,
            cpuPeriod:CpuPeriod, cpuQuota:CpuQuota, cpusetCpus:CpusetCpus, shmBytes:ShmSize};
    };
    // Native browsers and checkpoint execution run in this driver, not in the
    // installed Compose runner. Record the actual process container separately.
    const hostname = require('node:os').hostname();
    assert.match(hostname, /^[a-f0-9]{12,64}$/, 'Expected a container execution hostname');
    const driver = inspect(hostname);
    assert.ok(driver.Id.startsWith(hostname), 'Execution container identity mismatch');
    assert.equal(driver.Config.Labels?.['org.magelens.role'], 'branching-driver');
    assert.equal(driver.Config.Labels?.['org.magelens.workspace'], backend.workspace);
    assert.equal(driver.Config.WorkingDir, backend.workspace);
    assert.ok(driver.HostConfig.Memory > 0 && driver.HostConfig.NanoCpus > 0,
        'Catalog execution requires bounded driver memory and CPU');
    return {execution:resources(driver), ...Object.fromEntries(['app', 'phpfpm', 'db', 'redis', 'opensearch', 'runner'].map(service => {
        // The retained override is removed by cleanup. Query the owned Compose
        // project through its original files in all phases, including cleanup.
        const id = backend.dc(['ps', '-a', '-q', service], true);
        assert.match(id, /^[a-f0-9]{12,64}$/);
        return [service, resources(inspect(id))];
    }))};
}

function assertCatalogEnvironment(snapshot, runtimeContext) {
    assert.equal(snapshot.environment?.executionRuntimeDigest, digest(runtimeContext),
        'Frozen forecast does not identify the actual execution environment');
    assert.equal(snapshot.environmentDigest,
        require('./index.cjs').sha256(JSON.stringify(Object.entries(snapshot.environment).sort())),
        'Frozen environment identity changed');
}

// Admit only complete collection attempts. Historical probes without cleanup and
// finalization evidence remain diagnostics, even when their timings look useful.
function catalogObservations({manifest, candidateId, report, coverageResult, coverageSummary}) {
    const snapshot = manifest.assessment?.stages?.[candidateId]?.trainingSnapshot;
    assert.equal(snapshot?.timingBoundary, SEGMENT_TIMING_BOUNDARY);
    assert.equal(snapshot.unit, 'prefix');
    assert.ok(snapshot.modelId && snapshot.sourceDigest && snapshot.environmentDigest);
    assert.equal(report.kind, 'catalog-qualification-measurement');
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.errors, []);
    assert.equal(report.cleanupVerified, true, 'Missing successful cleanup audit');
    assert.ok(report.runtimeContext?.before && report.runtimeContext?.after, 'Missing runtime context audit');
    const execution = report.runtimeContext.before.execution;
    assert.ok(execution?.image && execution.memoryBytes > 0 && execution.nanoCpus > 0,
        'Missing bounded execution-container audit');
    assertCatalogEnvironment(snapshot, report.runtimeContext.before);
    assert.deepEqual(report.runtimeContext.after, report.runtimeContext.before, 'Runtime context changed during collection');
    assert.deepEqual(report.runtimeContext.afterNative, report.runtimeContext.before, 'Missing or changed native execution context');
    assert.equal(report.native?.executionRuntimeDigest, digest(report.runtimeContext.before),
        'Native collection has a different execution environment');
    assert.equal(report.sourceIntegrity?.verified, true);
    assert.equal(report.sourceIntegrity.digest, manifest.sourceDigest);
    const retained = report.providerDiagnostics?.retainedServices;
    assert.equal(retained?.schemasRemoved, true);
    assert.equal(retained.grantsRestored, true);
    for (const count of ['fallbacks', 'failures', 'blockedSpecs']) assert.equal(report.counts?.[count], 0);
    assert.equal(report.native?.coverageFinalized, true, 'Missing coverage finalization audit');
    assert.ok(report.native.coverageRunId);
    assert.equal(coverageResult.run, report.native.coverageRunId);
    assert.equal(coverageSummary.run, report.native.coverageRunId);
    assert.equal(coverageResult.status, 'passed');
    assert.equal(coverageResult.runner, 'playwright');
    assert.equal(coverageResult.maxAttempts, 1);
    for (const count of ['totalFailed', 'totalPending', 'totalSkipped']) assert.equal(coverageResult[count], 0);
    const total = manifest.tests.length;
    assert.ok(total > 0);
    for (const result of [report.native, coverageResult]) {
        assert.equal(result.totalTests, total);
        assert.equal(result.totalPassed, total);
    }
    assert.equal(coverageResult.tests.length, total);
    assert.ok(coverageResult.tests.every(test => test.status === 'passed'));
    assert.equal(coverageResult.browser?.name, 'chrome');
    assert.ok(coverageResult.browser.version);
    const samples = report.calibration.samples;
    assert.equal(samples.length, report.calibration.requestedSamples);
    assert.ok(samples.length > 0);
    assert.equal(new Set(samples.map(sample => sample.stage)).size, samples.length);
    return samples.map(sample => {
        assert.equal(sample.status, 'passed');
        assert.deepEqual(sample.runtimeContext, report.runtimeContext.before, 'Runtime context changed during prefix work');
        assert.equal(sample.segment?.forecastDigest, digest(snapshot));
        const observation = observeExecutedSegment(snapshot, {
            id: report.run + '/' + sample.stage, status: 'passed', wallMs: report.wallMs,
            prefixTiming: {timingBoundary: snapshot.timingBoundary, forecast: {digest: sample.segment.forecastDigest},
                fromDepth: snapshot.segment.fromDepth, toDepth: snapshot.segment.toDepth,
                kind: 'steps', workCompleted: true, workMs: sample.segment.workMs}
        }, {passed: true, attempts: 1, sourceDigest: snapshot.sourceDigest});
        assert.equal(observation.eligible, true, observation.exclusion);
        return {...observation, measurementKind:'retained-provider-segment',
            forecastDigest:sample.segment.forecastDigest,
            collectionRun: report.run, coverageRunId: coverageResult.run,
            collectionEvidenceDigest: digest({report, coverageResult, coverageSummary}),
            sourceVerified: true, suitePassed: true, coverageVerified: true, providerAuditPassed: true,
            attempts: 1};
    });
}

module.exports = {catalogObservations, catalogRuntimeContext, assertCatalogEnvironment};
