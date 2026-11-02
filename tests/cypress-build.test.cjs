// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {provenance, source, verifyInstalled} = require('../docker/runner/cypress-source/provenance.cjs');
test('local and CI runner validation rejects absent, stale and mismatched Cypress builds', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cypress-build-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const file = path.join(directory, 'build.json');
    assert.throws(() => verifyInstalled(file), /Rerun .\/install.sh/);
    fs.writeFileSync(file, JSON.stringify(provenance()));
    assert.deepEqual(verifyInstalled(file), provenance());
    for (const patch of [{commit: 'older'}, {version: '16.2.0'}, {patchSha256: 'stale'},
        {architecture: 'wrong'}, {distribution: 'stock'}, {buildNode: 'wrong'}]) {
        fs.writeFileSync(file, JSON.stringify({...provenance(), ...patch}));
        assert.throws(() => verifyInstalled(file), /missing or stale/);
    }
});
test('Cypress upgrades require reviewing the source patch before changing the pinned binary', () => {
    const dependencies = fs.readFileSync(path.join(__dirname, '../dependencies.yaml'), 'utf8');
    assert.equal(source.version, dependencies.match(/^CYPRESS_VERSION: "([^"]+)"$/m)[1]);
});
test('isolated runner regressions override and restore the shop URL on success and failure', async () => {
    const {runAgainstFixture} = require('./cypress-regressions.cjs');
    const original = process.env.CYPRESS_BASE_URL;
    try {
        for (const previous of [undefined, 'https://shop.example.test']) {
            for (const failure of [false, true]) {
                if (previous === undefined) delete process.env.CYPRESS_BASE_URL;
                else process.env.CYPRESS_BASE_URL = previous;
                const cypress = {async run(options) {
                    await Promise.resolve();
                    assert.equal(process.env.CYPRESS_BASE_URL, 'http://localhost:8123');
                    assert.equal(options.project, '/isolated-project');
                    assert.equal(options.browser, 'chrome-for-testing');
                    if (failure) throw new Error('browser failed');
                    return {totalPassed: 11};
                }};
                const run = runAgainstFixture(cypress, {baseUrl: 'http://localhost:8123'}, '/isolated-project');
                if (failure) await assert.rejects(run, /browser failed/);
                else assert.deepEqual(await run, {totalPassed: 11});
                assert.equal(process.env.CYPRESS_BASE_URL, previous);
            }
        }
    } finally {
        if (original === undefined) delete process.env.CYPRESS_BASE_URL;
        else process.env.CYPRESS_BASE_URL = original;
    }
});
