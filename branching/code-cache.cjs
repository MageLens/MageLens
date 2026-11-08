// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Let the browser cache within a branch. Restoring a checkpoint always clears
// the complete HTTP cache, including private and authenticated responses.
class CodeCache {
    constructor() { this.stats = {mode: 'browser-per-branch', hits: 0, clears: 0}; }
    async install(session) {
        await session.send('Network.clearBrowserCache');
        this.stats.clears++;
        await session.send('Network.setCacheDisabled', {cacheDisabled: false});
        session.on('Network.requestServedFromCache', () => this.stats.hits++);
    }
}
module.exports = {CodeCache};
