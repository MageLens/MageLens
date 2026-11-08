// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {BranchingProvider} = require('./provider.cjs');
const {replaceContents} = require('./storage.cjs');
const {implementationDigest} = require('./identity.cjs');

class RetainedProvider extends BranchingProvider {
    constructor(options) {
        super(options);
        this.identity.retained = implementationDigest([__filename, require.resolve('./storage.cjs')]);
    }
    async prefetch({directory}) {
        await this.backend.prefetch(path.join(directory ?? this.base, 'database', 'snapshot.sql'));
    }
    async restore(directory, {prefetch = null} = {}) {
        if (this.context) await this.browserState.freeze();
        await this.backend.drain();
        if (this.context) for (const page of this.context.pages()) await page.close();
        await this.backend.stop();
        for (const [name, destination] of Object.entries(this.backend.paths)) {
            replaceContents(path.join(directory, name), destination, this.directory);
        }
        await this.backend.resetCaches();
        await this.backend.start();
        if (prefetch) await this.prefetch(prefetch);
        await this.browserState.open(JSON.parse(fs.readFileSync(path.join(directory, 'browser.json'), 'utf8')));
    }
    async cleanup() {
        try { await super.cleanup(); }
        finally { this.diagnostics = {...this.diagnostics, retainedServices: this.backend.diagnostics}; }
    }
}
module.exports = {RetainedProvider};
