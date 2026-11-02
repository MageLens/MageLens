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
