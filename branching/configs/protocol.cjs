// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Values persisted in journals, checkpoint manifests and execution reports.
const status = Object.freeze({
    running: 'running',
    passed: 'passed',
    failed: 'failed',
    blocked: 'blocked',
    available: 'available',
    capturing: 'capturing'
});
const operation = Object.freeze({
    execute: 'executing',
    capture: 'capturing',
    restore: 'restoring',
    release: 'releasing'
});
const event = Object.freeze({
    runStart: 'run-start',
    runPhase: 'run-phase',
    runEnd: 'run-end',
    runError: 'run-error',
    nodeStart: 'node-start',
    nodeEnd: 'node-end',
    specStart: 'spec-start',
    specEnd: 'spec-end',
    checkpointReady: 'checkpoint-ready',
    checkpointInvalid: 'checkpoint-invalid',
    checkpointReleased: 'checkpoint-released',
    consumerFinished: 'consumer-finished',
    cleanupEnd: 'cleanup-end'
});
module.exports = {status, operation, event};
