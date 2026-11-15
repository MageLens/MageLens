// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {BranchingProvider} = require('./provider.cjs');
const {validateMutablePaths} = require('./snapshot-state.cjs');
const {implementationDigest} = require('./identity.cjs');

// Attach to an owned installation whose fixtures are established by the native
// runner. Capture, storage integrity, service fencing and restoration remain
// the same provider operations used by the other branching entry points.
class NativeProvider extends BranchingProvider {
    constructor(options) {
        super(options);
        this.contract = options.contract;
        for (const method of ['entryState', 'assertBoundary', 'abandon'])
            if (typeof this.contract?.[method] !== 'function') throw new Error(`Native lifecycle requires ${method}`);
        for (const method of ['pauseCoverage', 'resumeCoverage'])
            if (typeof this.browserState[method] !== 'function') throw new Error(`Native collection requires ${method}`);
        const {readContinuation, readFencedState} = this.contract;
        if ((readContinuation !== undefined || readFencedState !== undefined) &&
            (typeof readContinuation !== 'function' || typeof readFencedState !== 'function'))
            throw new Error('Native capture requires both continuation and fenced state readers');
        this.identity.native = implementationDigest([__filename]);
    }
    async attach({run, directory}) {
        if (typeof this.backend.attach !== 'function') throw new Error('Native backend must verify attachment ownership');
        this.run = run; this.directory = directory;
        await this.backend.attach({run, directory});
        validateMutablePaths(this.backend.paths, directory);
    }
    entryState(candidate, consumer) { return this.contract.entryState(this, candidate, consumer); }
    assessEntry(candidate, consumer) { return this.contract.assessEntry?.(this, candidate, consumer); }
    assessCapture(candidate, consumer) { return this.contract.assessCapture?.(this, candidate, consumer); }
    assertBoundary(candidate) { return this.contract.assertBoundary(this, candidate); }
    abandon(candidate, consumer) { return this.contract.abandon(this, candidate, consumer); }
    async captureBarrier() {
        await this.browserState.pauseCoverage();
        // Cypress must read the continuation before its command queue is
        // frozen. Application readers can then inspect the drained writers.
        const continuation = this.contract.readContinuation
            ? await this.contract.readContinuation(this)
            : await this.readState(this);
        await this.browserState.freeze();
        await this.backend.drain();
        this.captureState = this.contract.readFencedState
            ? await this.contract.readFencedState(this, continuation)
            : continuation;
        this.saved = await this.browserState.save();
    }
    async restoreBarrier() {
        // Cypress delivers the coverage pause through its live command queue.
        await this.browserState.pauseCoverage();
        await this.browserState.freeze();
    }
    async beginSegment() {
        // The native Cypress callback owns the existing page after capture.
        this.browserState.check();
        await this.browserState.resumeCoverage();
    }
    normalizedState() {
        return this.browserState.frozen ? this.captureState : this.readState(this);
    }
}
module.exports = {NativeProvider};
