// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const {createHash, randomUUID} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const config = require('./configs/baseline.json');
const projectRoot = path.resolve(__dirname, '..');
const operationDefaults = Object.freeze(require(path.join(projectRoot, config.paths.operationDefaults)));
const {metrics} = config;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const valid = (value) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
// Equivalent break-even for one checkpoint shared by exactly two tests.
// Fanout and nested checkpoints still use the full operation model.
function decisionBaselineMs(baseline) {
    return (
        (baseline.backendMs +
            baseline.firstResetMs +
            baseline.captureMs +
            baseline.restoreMs +
            baseline.releaseMs) *
            baseline.overheadMultiplier *
            (1 + baseline.overheadMargin) +
        baseline.minSavingMs
    );
}
function withDecisionBaseline(value) {
    if (!valid(value) || value <= operationDefaults.minSavingMs)
        throw new Error(config.messages.invalidDecision);
    const scale =
        (value - operationDefaults.minSavingMs) /
        (decisionBaselineMs(operationDefaults) - operationDefaults.minSavingMs);
    return Object.freeze({
        ...operationDefaults,
        ...Object.fromEntries(metrics.map((metric) => [metric, operationDefaults[metric] * scale]))
    });
}
const defaults = withDecisionBaseline(
    require(path.join(projectRoot, config.paths.decision)).checkpointDecisionBaselineMs
);
function validate(value) {
    if (
        !value ||
        Object.keys(value).sort().join() !== Object.keys(defaults).sort().join() ||
        value.version !== defaults.version ||
        value.overheadMultiplier !== defaults.overheadMultiplier ||
        value.overheadMargin !== defaults.overheadMargin ||
        value.minSavingMs !== defaults.minSavingMs ||
        metrics.some((key) => !valid(value[key])) ||
        value.captureMs + value.restoreMs <= 0
    )
        throw new Error(config.messages.invalidBaseline);
    return Object.freeze({...value});
}
function samples(report) {
    if (
        report.status !== config.labels.passed ||
        report.results?.some((result) => result.status !== config.labels.passed)
    )
        return null;
    const phases =
        report.kind === config.labels.calibration
            ? [report]
            : Array.isArray(report.phases)
              ? report.phases
                    .filter((phase) => phase.kind === config.labels.checkpoint)
                    .map((phase) => phase.report)
              : [];
    if (!phases.length) return null;
    const collected = Object.fromEntries(metrics.map((key) => [key, []]));
    for (const phase of phases) {
        if (
            phase.status !== config.labels.passed ||
            phase.errors?.length ||
            phase.counts?.fallbacks !== 0 ||
            phase.counts?.failures ||
            phase.counts?.blockedSpecs ||
            !phase.checkpoints?.length ||
            phase.checkpoints.length !== phase.releases?.length ||
            !phase.providerDiagnostics?.retainedServices?.schemasRemoved ||
            !phase.providerDiagnostics?.retainedServices?.grantsRestored
        )
            return null;
        for (const [metric, field] of Object.entries(config.operations))
            collected[metric].push(...(phase.costs?.[field] ?? []).map((item) => item.ms));
        const resets = phase.costs?.resets ?? [];
        if (resets.length) {
            collected.firstResetMs.push(resets[0]);
            collected.resetMs.push(...resets.slice(1));
        }
        collected.backendMs.push(phase.phases?.prepare + phase.phases?.cleanup);
    }
    if (
        !collected.captureMs.length ||
        !collected.restoreMs.length ||
        Object.values(collected)
            .flat()
            .some((value) => !valid(value))
    )
        return null;
    return collected;
}
class Store {
    constructor({
        workspace,
        key,
        updateOnSuccess = config.policy.updateOnSuccess,
        regressionThreshold = config.policy.regressionThreshold
    }) {
        if (typeof key !== 'string' || !key || typeof updateOnSuccess !== 'boolean')
            throw new Error(config.messages.invalidConfiguration);
        if (!Number.isFinite(regressionThreshold) || regressionThreshold < 0 || regressionThreshold > 1)
            throw new Error(config.messages.invalidThreshold);
        this.file = path.join(workspace, config.paths.baseline);
        this.key = hash(JSON.stringify({key, decisionBaselineMs: decisionBaselineMs(defaults)}));
        this.updateOnSuccess = updateOnSuccess;
        this.historyFile = path.join(workspace, config.paths.history);
        this.regressionThreshold = regressionThreshold;
    }
    read() {
        try {
            const stat = fs.lstatSync(this.file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > config.policy.maxRecordBytes)
                return null;
            const record = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (
                record.schemaVersion !== config.policy.schemaVersion ||
                record.key !== this.key ||
                record.defaultVersion !== defaults.version ||
                !record.statistics
            )
                return null;
            for (const key of metrics) {
                const item = record.statistics[key];
                if (
                    !item ||
                    !Number.isSafeInteger(item.count) ||
                    item.count < 0 ||
                    !valid(item.sumMs) ||
                    (!item.count && item.sumMs !== 0)
                )
                    return null;
                if (item.count && !valid(record.reference?.[key])) return null;
            }
            return record;
        } catch (error) {
            if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
            throw error;
        }
    }
    load() {
        const record = this.read(),
            baseline = {...defaults},
            counts = {};
        if (record)
            for (const key of metrics) {
                const item = record.statistics[key];
                counts[key] = item.count;
                if (item.count) baseline[key] = item.sumMs / item.count;
            }
        return Object.freeze({
            source: record ? config.labels.measured : config.labels.default,
            key: this.key,
            baseline: validate(baseline),
            decisionBaselineMs: decisionBaselineMs(baseline),
            samples: Object.freeze(counts)
        });
    }
    update(report, {explicit = false, replace = false} = {}) {
        if (!explicit && !this.updateOnSuccess)
            return {updated: false, reason: config.labels.updatesDisabled};
        const values = samples(report);
        if (!values) return {updated: false, reason: config.labels.noMeasurements};
        if (
            fs.existsSync(this.file) &&
            (!fs.lstatSync(this.file).isFile() || fs.lstatSync(this.file).isSymbolicLink())
        )
            throw new Error(config.messages.invalidCache);
        const previousBaseline = this.load().baseline,
            existing = this.read();
        const previous = replace ? null : existing;
        const statistics =
            previous?.statistics ?? Object.fromEntries(metrics.map((key) => [key, {count: 0, sumMs: 0}]));
        for (const key of metrics) {
            statistics[key].count += values[key].length;
            statistics[key].sumMs += values[key].reduce((sum, value) => sum + value, 0);
            if (!Number.isSafeInteger(statistics[key].count) || !valid(statistics[key].sumMs))
                throw new Error(config.messages.overflow);
        }
        const observed = Object.fromEntries(
            metrics
                .filter((key) => values[key].length)
                .map((key) => [key, values[key].reduce((sum, value) => sum + value, 0) / values[key].length])
        );
        const reference = {...(previous?.reference ?? observed)};
        for (const [key, value] of Object.entries(observed))
            if (reference[key] === undefined) reference[key] = value;
        const comparisonReference = existing?.reference ?? previousBaseline;
        const regressions = Object.entries(observed)
            .filter(
                ([key, value]) =>
                    value - (comparisonReference[key] ?? previousBaseline[key]) >=
                        config.policy.minimumRegressionMs &&
                    value >
                        (comparisonReference[key] ?? previousBaseline[key]) * (1 + this.regressionThreshold)
            )
            .map(([metric, observedMs]) => ({
                metric,
                referenceMs: comparisonReference[metric] ?? previousBaseline[metric],
                previousMs: previousBaseline[metric],
                observedMs,
                samples: values[metric].length,
                increase: comparisonReference[metric] ? observedMs / comparisonReference[metric] - 1 : null
            }));
        const record = {
            schemaVersion: config.policy.schemaVersion,
            key: this.key,
            defaultVersion: defaults.version,
            updatedAt: new Date().toISOString(),
            statistics,
            reference
        };
        const nextBaseline = {...defaults};
        for (const key of metrics)
            if (statistics[key].count) nextBaseline[key] = statistics[key].sumMs / statistics[key].count;
        const directory = path.dirname(this.file);
        fs.mkdirSync(directory, {recursive: true});
        if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(config.messages.linkedDirectory);
        if (
            fs.existsSync(this.historyFile) &&
            (!fs.lstatSync(this.historyFile).isFile() || fs.lstatSync(this.historyFile).isSymbolicLink())
        )
            throw new Error(config.messages.invalidHistory);
        const temporary = this.file + '.' + randomUUID() + '.tmp';
        try {
            const fd = fs.openSync(temporary, 'wx', 0o600);
            try {
                fs.writeFileSync(fd, JSON.stringify(record, null, 2) + '\n');
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            const uid = Number(process.env.MAGELENS_HOST_UID),
                gid = Number(process.env.MAGELENS_HOST_GID);
            if (Number.isInteger(uid) && Number.isInteger(gid)) fs.chownSync(temporary, uid, gid);
            const history = fs.openSync(this.historyFile, 'a', 0o600);
            try {
                fs.writeFileSync(
                    history,
                    JSON.stringify({
                        schemaVersion: config.policy.schemaVersion,
                        key: this.key,
                        defaultVersion: defaults.version,
                        recordedAt: record.updatedAt,
                        explicit,
                        replace,
                        previousBaseline,
                        observed,
                        nextBaseline,
                        regressions
                    }) + '\n'
                );
                fs.fsyncSync(history);
            } finally {
                fs.closeSync(history);
            }
            if (Number.isInteger(uid) && Number.isInteger(gid)) fs.chownSync(this.historyFile, uid, gid);
            fs.renameSync(temporary, this.file);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
        return {updated: true, regressions, ...this.load()};
    }
}
function openProject(workspace, configuration = {}) {
    const sql = config.commands.databaseSizeQuery;
    const databaseBytes = Number(
        execFileSync(path.join(workspace, config.paths.compose), [...config.commands.databaseSize, sql], {
            encoding: 'utf8',
            timeout: config.policy.commandTimeoutMs,
            maxBuffer: config.policy.queryMaxBytes
        }).trim()
    );
    if (!valid(databaseBytes)) throw new Error(config.messages.databaseSize);
    const files = config.paths.identity;
    const ids = execFileSync(path.join(workspace, config.paths.compose), config.commands.services, {
        encoding: 'utf8',
        timeout: config.policy.commandTimeoutMs
    })
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (ids.length !== 2) throw new Error(config.messages.missingServices);
    const containers = JSON.parse(
        execFileSync('docker', [...config.commands.inspect, ...ids], {
            encoding: 'utf8',
            timeout: config.policy.commandTimeoutMs,
            maxBuffer: config.policy.inspectMaxBytes
        })
    );
    const services = containers
        .map((container) => ({
            service: container.Config.Labels[config.labels.composeService],
            image: container.Image,
            memory: container.HostConfig.Memory,
            cpuQuota: container.HostConfig.CpuQuota,
            nanoCpus: container.HostConfig.NanoCpus,
            configuration: container.Mounts.filter(
                (mount) =>
                    /\.(ini|conf)$/.test(mount.Destination) &&
                    fs.existsSync(mount.Source) &&
                    fs.statSync(mount.Source).isFile()
            )
                .map((mount) => [mount.Destination, hash(fs.readFileSync(mount.Source))])
                .sort()
        }))
        .sort((a, b) => a.service.localeCompare(b.service));
    const identity = {
        version: defaults.version,
        architecture: process.arch,
        cpu: os.cpus()[0]?.model,
        // Reuse averages only within a database-size cohort. Small fixtures share
        // a 16 MiB floor; doubling a larger database starts from defaults again.
        databaseSizeBucket: Math.floor(
            Math.log2(Math.max(config.policy.databaseBucketFloorBytes, databaseBytes))
        ),
        services,
        image: process.env.MAGELENS_BRANCHING_IMAGE,
        runner: process.env.MAGELENS_RUNNER ?? 'playwright',
        playwright: process.env.PLAYWRIGHT_VERSION,
        cypress: process.env.CYPRESS_VERSION,
        chrome: process.env.CHROME_VERSION,
        files: Object.fromEntries(
            files.map((file) => [
                file,
                fs.existsSync(path.join(workspace, file))
                    ? hash(fs.readFileSync(path.join(workspace, file)))
                    : null
            ])
        )
    };
    return new Store({
        workspace,
        key: hash(JSON.stringify(identity)),
        updateOnSuccess: configuration.updateOnSuccess ?? config.policy.updateOnSuccess,
        regressionThreshold: configuration.regressionThreshold ?? config.policy.regressionThreshold
    });
}
module.exports = {defaults, validate, samples, Store, openProject, decisionBaselineMs, withDecisionBaseline};
