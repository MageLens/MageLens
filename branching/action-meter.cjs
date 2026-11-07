// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Playwright 1.65 client instrumentation counts actual API calls, including
// calls inside page objects. It never retains selectors, arguments or secrets.
// This is a diagnostic for explicit benchmarks; it never updates the static policy.
class ActionMeter {
    constructor(browser) {
        this.instrumentation = browser._instrumentation;
        this.listener = {onApiCallBegin: (zone, call) => {
            if (!this.current || zone.internal) return;
            const name = zone.apiName || `${call.type}.${call.method}`;
            this.current.total++;
            this.current.byApi[name] = (this.current.byApi[name] ?? 0) + 1;
        }};
        this.instrumentation?.addListener(this.listener);
    }
    start() { this.current = this.instrumentation ? {total: 0, byApi: {}} : null; }
    finish() { const result = this.current; this.current = null; return result; }
    close() { this.current = null; this.instrumentation?.removeListener(this.listener); this.instrumentation = null; }
}
module.exports = {ActionMeter};
