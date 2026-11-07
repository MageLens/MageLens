// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const dashboard = Object.freeze({
    host: '127.0.0.1',
    port: 4173,
    pollMs: 250,
    heartbeatMs: 10000,
    drainTimeoutMs: 10000,
    maxJournalBytes: 4 * 1024 * 1024,
    maxRuns: 20,
    maxViewers: 32,
    eventDirectory: '.runtime/branching-events',
    manifest: '.runtime/branching-plan.json'
});
const http = Object.freeze({
    stateRoute: '/api/state',
    streamRoute: '/events',
    cacheControl: 'no-store',
    contentTypeOptions: 'nosniff',
    contentSecurityPolicy:
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
    localOnly: 'Local dashboard only',
    notFound: 'Not found',
    tooManyViewers: 'Too many viewers',
    updating: 'Dashboard update in progress.',
    journalEvent: 'journal',
    snapshotEvent: 'snapshot',
    reconnectMs: 1000
});
const warnings = Object.freeze({
    journalInvalid: 'An incomplete or invalid event journal could not be read.',
    manifestInvalid: 'The source manifest could not be read.',
    assetsUpdating: 'Dashboard files are being updated; waiting for a complete revision.',
    directoryUnreadable: 'Cannot read the event directory.',
    journalTooLarge: 'An event journal exceeds the dashboard size limit.',
    journalUnreadable: 'An event journal could not be read.',
    scanFailed: 'Event discovery failed; the last complete state is displayed.'
});
module.exports = {dashboard, http, warnings};
