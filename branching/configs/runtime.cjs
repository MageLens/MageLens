// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const APPROACH = Object.freeze({branching: 'branching', linear: 'L0', automatic: 'AUTO'});
// Internal execution outcomes, not selectable user policies.
const executionApproaches = Object.freeze([APPROACH.linear, APPROACH.branching]);
const files = Object.freeze({
    manifest: 'manifest.json',
    payload: 'payload',
    operation: 'operation.json',
    owner: 'owner.json',
    browser: 'browser.json',
    baseline: 'baseline',
    runPrefix: 'run-',
    pendingSuffix: '.pending'
});
const checkpoint = Object.freeze({
    ttlMs: 3600000,
    boundary: 'quiescent-v1',
    ownerKind: 'magelens-branching',
    lifetime: 'run',
    lastConsumer: 'last-consumer',
    restoreValidation: 'first-reuse'
});
const provider = Object.freeze({
    lifecycle: ['prepare', 'drain', 'pause', 'unpause', 'stop', 'start', 'resetCaches', 'cleanup'],
    workload: 'playwright-workflow',
    capability: 'filesystem-cow-browser-reconstruction',
    coverage: 'unsupported',
    blankUrl: 'about:blank',
    idPrefix: 'branch'
});
const accounting = {
    method: 'Sum of allocated blocks for all run files; shared CoW blocks may be counted repeatedly. Not physical or exclusive usage.'
};
module.exports = {APPROACH, executionApproaches, files, checkpoint, provider, accounting};
