// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {retryDownload, prepareElectron} = require('../docker/runner/cypress-source/prepare-electron.cjs');

test('Electron downloads recover only from transient transport failures and stay bounded', async () => {
    for (const failure of [{response: {statusCode: 504}}, {code: 'ECONNRESET'}]) {
        let attempts = 0;
        const delays = [];
        const archive = await retryDownload(async () => {
            if (++attempts < 3) throw failure;
            return 'verified.zip';
        }, async ms => delays.push(ms));
        assert.equal(archive, 'verified.zip');
        assert.equal(attempts, 3);
        assert.deepEqual(delays, [5000, 10000]);
    }
    for (const [failure, count] of [[{response: {statusCode: 503}}, 4],
        [{response: {statusCode: 404}}, 1], [new Error('Checksum mismatch'), 1], [{code: 'ABORT_ERR'}, 1]]) {
        let attempts = 0;
        await assert.rejects(retryDownload(async () => { attempts++; throw failure; }, async () => {}), error => error === failure);
        assert.equal(attempts, count);
    }
});

function fixture(t, failure) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-electron-download-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const config = {afterPack: './scripts/after-pack-hook.js', linux: {executableName: 'Cypress'}};
    fs.writeFileSync(path.join(root, 'electron-builder.json'), JSON.stringify(config));
    const requests = [];
    let metadataWrites = 0;
    const dependencies = {
        version: '41.7.0', platform: 'linux', arch: 'x64', snapshot: {binDir: path.join(root, 'snapshot-tools')},
        async downloadArtifact(options) {
            requests.push(options);
            if (failure === 'checksum') throw new Error('Checksum mismatch');
            return options.artifactName;
        },
        async extractZip(artifact, {dir}) {
            fs.mkdirSync(dir, {recursive: true});
            if (artifact === 'electron') {
                fs.writeFileSync(path.join(dir, 'version'), failure === 'version' ? '41.6.0' : '41.7.0');
                fs.writeFileSync(path.join(dir, 'electron'), 'binary', {mode: 0o755});
            } else {
                fs.writeFileSync(path.join(dir, 'mksnapshot'), 'binary');
                if (failure !== 'missing') fs.writeFileSync(path.join(dir, 'v8_context_snapshot_generator'), 'binary');
            }
        },
        async writeMetadata() { metadataWrites++; }
    };
    return {root, config, dependencies, requests, writes: () => metadataWrites};
}

test('Cypress packaging uses the verified exact-version distribution and retains all hooks', async t => {
    const f = fixture(t);
    await prepareElectron(f.root, f.dependencies);
    assert.deepEqual(f.requests, ['electron', 'mksnapshot'].map(artifactName => ({
        artifactName, version: '41.7.0', platform: 'linux', arch: 'x64',
        downloadOptions: {timeout: {request: 120000}, retry: {limit: 0}}
    })));
    assert.equal(f.writes(), 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'electron-builder.json'))), {
        ...f.config, electronDist: path.join(f.root, '.magelens-electron')
    });
});

for (const failure of ['checksum', 'version', 'missing']) {
    test(`Cypress rejects ${failure} failures before marking snapshot tools ready`, async t => {
        const f = fixture(t, failure);
        await assert.rejects(prepareElectron(f.root, f.dependencies));
        assert.equal(f.writes(), 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'electron-builder.json'))), f.config);
        assert.ok(f.requests.every(request => request.version === '41.7.0'), 'Never fall back to a different Electron patch');
    });
}
