// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path = require('node:path');
const {digest} = require('../../identity.cjs');
const {Economics} = require('../../adaptive.cjs');
const {CheckpointStore} = require('../../checkpoint-store.cjs');
const {defaults} = require('../../baseline.cjs');

// Native execution owns test and hook scheduling. This controller owns only a
// verified boundary; it never invokes a test, hook, fixture, or extracted body.
class NativeSession {
    constructor({plan, provider, directory, run, bridge, verifySources, emit = () => {}, baseline = defaults,
        statistics, linear = false, now = () => performance.now()}) {
        for (const name of ['entryState', 'assertBoundary', 'abandon', 'captureBarrier', 'capture',
            'resumeCapture', 'restore', 'normalizedState', 'cleanup']) {
            if (typeof provider[name] !== 'function') throw new Error(`Native checkpoint provider requires ${name}`);
        }
        if (typeof verifySources !== 'function') throw new Error('Native checkpoints require source verification');
        this.verifySources = verifySources; this.provider = provider; this.bridge = bridge;
        this.emit = emit; this.now = now; this.linear = linear;
        this.lifecycleMs = 0;
        this.economics = new Economics(baseline, emit, statistics);
        this.store = new CheckpointStore(directory, run, digest({plan, provider: provider.identity}));
        this.candidates = new Map(); this.consumers = new Set(); this.finished = new Set();
        for (const candidate of plan) {
            if (this.candidates.has(candidate.id) || candidate.consumers.length < 2) throw new Error('Invalid native checkpoint candidate');
            for (const consumer of candidate.consumers) {
                if (this.consumers.has(consumer)) throw new Error('Overlapping native checkpoint consumers');
                this.consumers.add(consumer);
            }
            this.candidates.set(candidate.id, {...candidate, remaining: candidate.consumers.length, started: new Set()});
        }
        this.report = {run, checkpoints: [], restores: [], prefixes: [], decisions: this.economics.decisions,
            observations: this.economics.observations, errors: [], status: 'running'};
    }
    async boundary(message) {
        const started = this.now();
        try {
            await this.verifySources();
            const candidate = this.candidates.get(message.checkpoint);
            if (!candidate || !candidate.consumers.includes(message.consumer)) throw new Error('Unknown native checkpoint consumer');
            if (message.phase === 'enter') await this.enter(candidate, message.consumer, message.bindings, started);
            else if (message.phase === 'complete') await this.complete(candidate, message.consumer, message.workMs, message.unsupportedRunnerState, started, message.bindings);
            else throw new Error('Unknown native checkpoint phase');
        } catch (error) {
            this.report.errors.push({phase: message.phase, checkpoint: message.checkpoint, message: error.message});
            this.emit('run-error', {phase: 'native checkpoint', node: message.checkpoint});
            throw error;
        }
    }
    async enter(candidate, consumer, bindings, started = this.now()) {
        if (this.active || candidate.started.has(consumer)) throw new Error('Native checkpoint callback repeated or reordered');
        candidate.started.add(consumer);
        // Runs after the original beforeEach hooks, including their awaited work.
        // The provider must compare all fixture, runner/plugin and application
        // inputs that can affect this prefix, not merely its browser URL.
        if (bindings?.eligible !== true) {
            candidate.disabled = true;
            this.emit('checkpoint-ineligible', {node: candidate.id, reason: 'opaque-lexical-input'});
        }
        if (!candidate.disabled && !this.linear) {
            const reason = await this.provider.assessEntry?.(candidate, consumer);
            if (reason) {
                candidate.disabled = true;
                this.emit('checkpoint-ineligible', {node: candidate.id, reason});
            }
        }
        const ref = this.store.available.get(candidate.id);
        const entry = ref || (!candidate.disabled && !this.linear)
            ? digest(await this.provider.entryState(candidate, consumer)) : undefined;
        const compatible = candidate.entry === undefined ||
            (candidate.entry === entry && candidate.bindings === digest(bindings));
        if (entry !== undefined && candidate.entry === undefined) {
            candidate.entry = entry;
            candidate.bindings = digest(bindings);
        }
        if (!compatible && !candidate.disabled && !this.linear) {
            candidate.disabled = true;
            this.emit('checkpoint-ineligible', {node: candidate.id, reason: 'changed-entry-state'});
        }
        if (!candidate.disabled && !this.linear) await this.provider.beginPrefix?.(candidate, consumer);
        this.active = {candidate, consumer, compatible, bindings};
        if (ref) {
            if (!candidate.disabled && this.economics.decide(candidate.id, candidate.prefixMs, candidate.remaining, {captured: true})) {
                const time = started;
                this.emit('node-start', {node: candidate.id, operation: 'restore'});
                try {
                    const manifest = this.store.verify(ref, this.key(candidate));
                    await this.provider.restore(path.join(ref.directory, 'payload'));
                    await this.provider.assertBoundary(candidate);
                    if (digest(await this.provider.normalizedState()) !== manifest.expectedStateDigest)
                        throw new Error('Native checkpoint restored state mismatch');
                    await this.verifyBindings(bindings);
                    await this.verifySources();
                    await this.provider.beginSegment?.();
                    const ms = this.now() - time;
                    this.economics.observe('restoreMs', ms, candidate.id);
                    this.report.restores.push({checkpoint: ref.id, consumer, ms});
                    this.emit('node-end', {node: candidate.id, checkpoint: ref.id, operation: 'restore', status: 'passed', ms});
                    await this.consumed(candidate, consumer);
                    this.bridge.continue({restored: true});
                    return;
                } catch (error) {
                    this.emit('node-end', {node: candidate.id, operation: 'restore', status: 'failed', ms: this.now() - time});
                    // A partially restored application must never continue the
                    // original callback or turn a failed restore into a pass.
                    throw error;
                }
            }
            const time = this.now();
            await this.provider.abandon(candidate, consumer);
            if (digest(await this.provider.entryState(candidate, consumer)) !== entry ||
                digest(await this.bridge.call('bindings')) !== digest(bindings))
                throw new Error('Native checkpoint abandonment changed the original fixture state');
            this.economics.observe('resetMs', this.now() - time, candidate.id);
            await this.release(candidate);
            candidate.disabled = true;
            this.emit('checkpoint-reuse-abandoned', {node: candidate.id, remaining: candidate.remaining, resetVerified: true});
        }
        this.active.started = this.now();
        this.lifecycleMs += this.now() - started;
        this.emit('node-start', {node: candidate.id, operation: 'execute'});
        this.bridge.continue({restored: false});
    }
    key(candidate) { return digest({id: candidate.id, entry: candidate.entry, bindings: candidate.bindings, identity: candidate.identity}); }
    async complete(candidate, consumer, workMs, unsupportedRunnerState = [], started = this.now(), bindings) {
        const active = this.active;
        if (!active || active.candidate !== candidate || active.consumer !== consumer ||
            !Number.isFinite(workMs) || workMs < 0 || workMs > this.now() - active.started + 1000)
            throw new Error('Invalid native checkpoint completion');
        if (!Array.isArray(unsupportedRunnerState) || unsupportedRunnerState.some(name => typeof name !== 'string'))
            throw new Error('Invalid native runner capability evidence');
        // The current native continuation restores application/browser state,
        // not JavaScript lexical cells in the spec module. If prefix work
        // changes a witnessed cell, skipping that work cannot be equivalent.
        if (bindings?.eligible !== true || active.bindings?.eligible !== true || digest(bindings) !== digest(active.bindings)) {
            candidate.disabled = true;
            this.emit('checkpoint-ineligible', {node: candidate.id, reason: 'changed-or-unverified-closure-state'});
        }
        if (unsupportedRunnerState.length) {
            candidate.disabled = true;
            this.emit('checkpoint-ineligible', {node: candidate.id, reason: 'prefix-changed-runner-state',
                operations: [...new Set(unsupportedRunnerState)]});
        }
        // Browser time begins immediately before the closure and ends only once
        // its Cypress queue drains. Task/bridge roundtrips are not avoided work.
        candidate.prefixMs = candidate.prefixMs === undefined ? workMs : Math.min(candidate.prefixMs, workMs);
        this.report.prefixes.push({checkpoint: candidate.id, consumer, workMs});
        this.emit('node-end', {node: candidate.id, operation: 'execute', status: 'passed', ms: workMs});
        const profitable = !this.linear && active.compatible && !candidate.disabled && !this.store.available.has(candidate.id) &&
            this.economics.decide(candidate.id, candidate.prefixMs, candidate.remaining - 1, {initialReset: false});
        const reason = profitable && await this.provider.assessCapture?.(candidate, consumer);
        if (reason) {
            candidate.disabled = true;
            this.emit('checkpoint-ineligible', {node: candidate.id, reason});
        }
        if (profitable && !reason) {
            const time = started;
            await this.provider.assertBoundary(candidate);
            this.emit('node-start', {node: candidate.id, operation: 'capture'});
            const ref = await this.store.capture({key: this.key(candidate), stage: candidate.id, parent: null,
                lineage: [consumer], ttlMs: 24 * 60 * 60 * 1000, provider: this.provider,
                measured: (_name, operation) => operation(), assert: () => this.provider.assertBoundary(candidate)});
            await this.verifyBindings(bindings);
            await this.verifySources();
            await this.provider.beginSegment?.();
            const ms = this.now() - time;
            this.economics.observe('captureMs', ms, candidate.id);
            this.economics.lifecycleCharged = true;
            this.report.checkpoints.push({id: ref.id, stage: candidate.id, ms});
            this.emit('checkpoint-ready', {node: candidate.id, checkpoint: ref.id, ms});
        } else this.lifecycleMs += this.now() - started;
        await this.consumed(candidate, consumer);
        this.bridge.continue({restored: false});
    }
    async consumed(candidate, consumer) {
        this.active = null; this.finished.add(consumer); candidate.remaining--;
        this.emit('consumer-finished', {node: candidate.id, spec: consumer, remaining: candidate.remaining});
        if (!candidate.remaining) await this.release(candidate);
    }
    async verifyBindings(expected) {
        const actual = await this.bridge.call('bindings');
        if (actual?.eligible !== true || digest(actual) !== digest(expected))
            throw new Error('Native checkpoint changed the original closure state');
    }
    async release(candidate) {
        const time = this.now(), checkpoint = this.store.release(candidate.id);
        if (checkpoint) {
            const ms = this.now() - time;
            this.economics.observe('releaseMs', ms, candidate.id);
            this.emit('checkpoint-released', {node: candidate.id, checkpoint, ms});
        }
    }
    async close({passed = false} = {}) {
        if (this.active && !this.report.errors.length) {
            const node = this.active.candidate.id;
            this.report.errors.push({phase: 'prefix', checkpoint: node, message: 'Original callback did not reach its checkpoint boundary'});
            this.emit('node-end', {node, operation: 'execute', status: 'failed'});
        }
        try {
            for (const candidate of this.candidates.values()) await this.release(candidate);
        } finally {
            try { this.store.discardIncomplete(); }
            finally { await this.provider.cleanup(); }
        }
        this.report.cleanup = {storageReleased: this.store.available.size === 0 && this.store.incomplete.size === 0};
        await this.verifySources();
        this.report.status = passed && !this.report.errors.length && this.finished.size === this.consumers.size ? 'passed' : 'failed';
        this.report.statisticsAfter = this.economics.statistics;
        this.report.baselineAfter = this.economics.baseline;
        return this.report;
    }
}
module.exports = {NativeSession};
