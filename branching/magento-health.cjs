// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const {settings} = require('./configs/magento.cjs');

const {setTimeout: delay} = require('node:timers/promises');
function checkpointNginx(source) {
    if (!/\bhttp\s*\{/.test(source)) throw new Error(messages.expectedAnNginxHttpConfiguration);
    if (/^\s*client_header_timeout\s/m.test(source)) {
        throw new Error(messages.customNginxConnectionTimeoutsNeedAnExplicitCheckpoint);
    }
    // Chrome may leave speculative connections without an HTTP request. Bound
    // only their request-header wait, not active requests or graceful shutdown.
    return source.replace(/\bhttp\s*\{/, 'http {\n  client_header_timeout 5s;');
}
async function resumedHealth(inspect, previousProbe, timeout = settings.healthTimeoutMs) {
    const deadline = Date.now() + timeout;
    while (true) {
        const state = inspect().State,
            probe = state.Health?.Log?.at(-1);
        if (!state.Running || state.Paused || state.OOMKilled)
            throw new Error(messages.resumedDatabaseIsNotRunningSafely);
        // Docker intentionally marks health unhealthy when pausing its monitor.
        // Require a new successful probe; a new failed probe is a real failure.
        if (probe && probe.End !== previousProbe) {
            if (probe.ExitCode !== 0) throw new Error(messages.databaseHealthProbeFailedAfterUnpause);
            if (state.Health.Status === 'healthy') return;
        }
        if (Date.now() >= deadline) throw new Error(messages.timedOutWaitingForDatabaseHealthAfterUnpause);
        await delay(settings.healthPollMs);
    }
}
module.exports = {checkpointNginx, resumedHealth};
