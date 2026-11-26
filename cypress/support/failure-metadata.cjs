// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

function retryAttemptNumber(...runnables) {
    for (const runnable of runnables) {
        if (!runnable) continue;
        let retry;
        try {
            retry = typeof runnable.currentRetry === 'function'
                ? runnable.currentRetry()
                : runnable._currentRetry;
        } catch { continue; }
        if (Number.isInteger(retry) && retry >= 0) return retry + 1;
    }
    return 1;
}

module.exports = {retryAttemptNumber};
