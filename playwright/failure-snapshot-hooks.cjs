// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

function observeTestFailures(testInfo, capture) {
    // In the pinned Playwright runner, thrown errors, soft assertions and
    // timeouts all pass through this per-attempt method before cleanup.
    const reportFailure = testInfo._failWithError;
    if (typeof reportFailure !== 'function') return () => {};
    testInfo._failWithError = function (error) {
        const result = reportFailure.call(this, error);
        if (this.status !== 'skipped' && this.status !== this.expectedStatus) {
            try {
                const hook = this._currentHookType?.();
                capture(hook ? `${hook}-hook` : 'test-body', error?.message || String(error));
            } catch { /* Diagnostics must not interfere with Playwright's error handling. */ }
        }
        return result;
    };
    return () => { testInfo._failWithError = reportFailure; };
}

module.exports = {observeTestFailures};
