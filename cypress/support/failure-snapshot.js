// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {failureHtmlFilename, failureSnapshotDocument, failureSnapshotUnavailable} = require('./failure-html.cjs');
const {retryAttemptNumber} = require('./failure-metadata.cjs');
let applicationWindow;
let latestHtml;
let captureError;
let writingSnapshot = false;
let testExecutionId;
const workerId = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function snapshotMetadata(test, attempt, phase) {
    let runId = 'run-unknown';
    try { runId = String(Cypress.expose('coverageRun') || runId); }
    catch { /* Warm-up and early failures may not expose a coverage run. */ }
    return {
        runner: 'cypress', runId, spec: Cypress.spec.relative,
        test: test?.fullTitle?.() || test?.titlePath?.join(' > ') || test?.title || 'unknown test',
        testExecutionId, attempt, workerId, phase, capturedAt: new Date().toISOString()
    };
}

function capture(document, test, attempt, phase) {
    if (!document?.documentElement) throw new Error('The application page is unavailable.');
    return failureSnapshotDocument(document, snapshotMetadata(test, attempt, phase));
}

Cypress.on('window:before:load', window => { applicationWindow = window; });
Cypress.on('test:before:run', () => {
    applicationWindow = undefined;
    latestHtml = undefined;
    captureError = undefined;
    writingSnapshot = false;
    testExecutionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
});
Cypress.on('fail', (error, runnable) => {
    if (writingSnapshot) {
        captureError = error?.code || 'Snapshot writing failed.';
        return false;
    }
    try {
        // Cypress replaces the application view with its failure overlay after this event.
        const window = applicationWindow || Cypress.state('window');
        const test = runnable?.ctx?.currentTest || Cypress.currentTest || runnable;
        const attempt = retryAttemptNumber(runnable, runnable?.ctx?.currentTest, Cypress.currentTest, test);
        latestHtml = capture(window?.document, test, attempt, 'cypress-fail-event');
    } catch (captureFailure) {
        captureError = captureFailure?.message || 'The application page could not be serialized.';
    }
    throw error;
});

beforeEach(() => { latestHtml = undefined; applicationWindow = undefined; captureError = undefined; writingSnapshot = false; });

afterEach(function () {
    if (this.currentTest?.state !== 'failed') return;
    const test = this.currentTest;
    const attempt = retryAttemptNumber(test);
    const metadata = snapshotMetadata(test, attempt, 'cypress-after-each');
    if (!latestHtml) {
        try {
            const window = applicationWindow || Cypress.state('window');
            latestHtml = failureSnapshotDocument(window?.document, metadata);
        } catch (error) {
            captureError = error?.message || captureError || 'The application page was unavailable.';
        }
    }
    latestHtml ||= failureSnapshotUnavailable(metadata, captureError || 'Cypress could not access the application page.');
    const filename = failureHtmlFilename(test.fullTitle(), {attempt, runId: metadata.runId, workerId});
    writingSnapshot = true;
    cy.task('failureSnapshot:write', {
        relativePath: `${Cypress.spec.relative}/${filename}`,
        html: latestHtml
    }, {log: false}).then(result => {
        writingSnapshot = false;
        if (!result?.saved) Cypress.log({name: 'HTML snapshot', message: `Could not save failure snapshot (${result?.reason || 'write error'}).`});
    }, error => {
        writingSnapshot = false;
        Cypress.log({name: 'HTML snapshot', message: `Could not save failure snapshot (${error.code || 'task error'}).`});
        return null;
    });
});
