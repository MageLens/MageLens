// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const protocol = require('./configs/protocol.cjs');

const {performance} = require('node:perf_hooks');
function createReport({
    run,
    approach,
    provider,
    graph,
    directory,
    checkpointLifetime,
    checkpointPolicy,
    limited
}) {
    const report = {
        schemaVersion: 1,
        run,
        approach,
        workload: provider.workload,
        capability: provider.capability,
        identity: graph.identity,
        runtime: provider.identity,
        directory,
        status: protocol.status.running,
        phases: {},
        segments: [],
        results: [],
        checkpoints: [],
        releases: [],
        checkpointLifetime,
        checkpointPolicy: checkpointPolicy ?? null,
        checkpointLimit: limited.report,
        counts: {prefixExecutions: 0, reuseHits: 0, fallbacks: 0, failures: 0, blockedSpecs: 0},
        errors: [],
        costs: {schemaVersion: 1, resets: [], captures: [], restores: [], releases: []},
        coverage: provider.coverageKind ?? 'unsupported',
        metrics: {peakPhysicalBytes: null, diskReadBytes: null, diskWriteBytes: null}
    };
    return report;
}

function startTiming() {
    return {start: performance.now(), cpu: process.cpuUsage()};
}

function reporting(report, emit, {start, cpu}) {
    const measured = async (phase, fn) => {
        const time = performance.now();
        try {
            return await fn();
        } finally {
            report.phases[phase] = (report.phases[phase] ?? 0) + performance.now() - time;
        }
    };
    const errorRecord = (phase, error, stage = null) => {
        report.errors.push({phase, stage, message: error.message});
        report.counts.failures++;
        emit(protocol.event.runError, {phase, node: stage});
    };
    function updateTiming() {
        report.metrics.wallMs = performance.now() - start;
        const used = process.cpuUsage(cpu);
        report.metrics.orchestratorCpuMs = (used.user + used.system) / 1000;
    }
    function finish(provider, selected) {
        report.status =
            report.results.length === selected.length &&
            report.results.every((result) => result.status === protocol.status.passed) &&
            report.errors.length === 0
                ? protocol.status.passed
                : protocol.status.failed;
        report.qualification =
            report.status === protocol.status.passed && report.errors.length === 0
                ? provider.workload === 'contract-fixture'
                    ? 'contract-only'
                    : 'scenario-only'
                : 'inconclusive';
        updateTiming();
        report.metrics.totalCpuMs = null; // Service/browser CPU needs external cgroup accounting.
        if (provider.diagnostics) report.providerDiagnostics = provider.diagnostics;
    }
    return {measured, errorRecord, finish, updateTiming};
}
module.exports = {createReport, reporting, startTiming};
