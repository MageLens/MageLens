// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {retryDownload, prepareElectron} = require(projectFile('docker/runner/cypress-source/prepare-electron.cjs'));

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

function fixture(t, failure, arch = 'x64') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-electron-download-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const config = {afterPack: './scripts/after-pack-hook.js', linux: {executableName: 'Cypress'}};
    fs.writeFileSync(path.join(root, 'electron-builder.json'), JSON.stringify(config));
    const requests = [];
    const dependencies = {
        version: '43.8.4', platform: 'linux', arch,
        async downloadArtifact(options) {
            requests.push(options);
            if (failure === 'checksum') throw new Error('Checksum mismatch');
            return options.artifactName;
        },
        async extractZip(artifact, {dir}) {
            if (failure === 'extraction') throw new Error('Invalid archive');
            fs.mkdirSync(dir, {recursive: true});
            assert.equal(artifact, 'electron', 'Cypress 16.4 no longer uses separate snapshot tools');
            fs.writeFileSync(path.join(dir, 'version'), failure === 'version' ? '43.8.3' : '43.8.4');
            if (failure === 'directory') fs.mkdirSync(path.join(dir, 'electron'));
            else if (failure !== 'missing') {
                fs.writeFileSync(path.join(dir, 'electron'), failure === 'empty' ? '' : 'binary', {
                    mode: failure === 'permissions' ? 0o644 : 0o755
                });
            }
        }
    };
    return {root, config, dependencies, requests};
}

for (const arch of ['x64', 'arm64']) {
    test(`Cypress ${arch} packaging uses the verified exact-version distribution and retains all hooks`, async t => {
        const f = fixture(t, undefined, arch);
        await prepareElectron(f.root, f.dependencies);
        assert.deepEqual(f.requests, [{
            artifactName: 'electron', version: '43.8.4', platform: 'linux', arch,
            downloadOptions: {timeout: {request: 120000}, retry: {limit: 0}}
        }]);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'electron-builder.json'))), {
            ...f.config, electronDist: path.join(f.root, '.magelens-electron')
        });
    });
}

for (const failure of ['checksum', 'extraction', 'version', 'missing', 'empty', 'directory', 'permissions']) {
    test(`Cypress rejects ${failure} failures before selecting the Electron distribution`, async t => {
        const f = fixture(t, failure);
        await assert.rejects(prepareElectron(f.root, f.dependencies));
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'electron-builder.json'))), f.config);
        assert.ok(f.requests.every(request => request.version === '43.8.4'), 'Never fall back to a different Electron patch');
    });
}
