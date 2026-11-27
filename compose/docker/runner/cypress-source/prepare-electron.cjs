// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {setTimeout: delay} = require('node:timers/promises');

async function retryDownload(download, wait = delay) {
    for (let attempt = 1; ; attempt++) {
        try { return await download(); }
        catch (error) {
            const status = error.response?.statusCode ?? error.statusCode;
            const temporary = [408, 429, 500, 502, 503, 504].includes(status) ||
                ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error.code);
            if (!temporary || attempt === 4) throw error;
            console.error(`Electron download interrupted; retrying (${attempt + 1}/4).`);
            await wait(attempt * 5000);
        }
    }
}

async function prepareElectron(root, dependencies) {
    const {version, platform, arch, downloadArtifact, extractZip, snapshot, writeMetadata} = dependencies;
    const directory = path.join(root, '.magelens-electron');
    // @electron/get validates release checksums. Do not retry checksum errors,
    // extraction errors or substitute a different Electron patch version.
    const download = artifactName => retryDownload(() => downloadArtifact({version, platform, arch, artifactName,
        downloadOptions: {timeout: {request: 120000}, retry: {limit: 0}}}));
    const electronZip = await download('electron');
    await extractZip(electronZip, {dir: directory});
    if (fs.readFileSync(path.join(directory, 'version'), 'utf8').trim() !== version) {
        throw new Error('Downloaded Electron version differs from the pinned source');
    }
    fs.accessSync(path.join(directory, 'electron'), fs.constants.X_OK);
    if (arch === 'x64') {
        const snapshotZip = await download('mksnapshot');
        await extractZip(snapshotZip, {dir: snapshot.binDir});
        // Upstream syncAndRun logs download failures but still writes metadata. Only
        // mark an exact-version download ready after its required tools are present.
        for (const executable of ['mksnapshot', 'v8_context_snapshot_generator']) {
            const file = path.join(snapshot.binDir, executable);
            if (!fs.statSync(file).isFile() || fs.statSync(file).size === 0) throw new Error(`Missing snapshot tool: ${executable}`);
            fs.chmodSync(file, 0o755);
            fs.accessSync(file, fs.constants.X_OK);
        }
        await writeMetadata();
    }
    const configFile = path.join(root, 'electron-builder.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    // Supply the verified distribution through electron-builder's normal input.
    // Its packaging hooks, snapshot generation and integrity checks still run.
    config.electronDist = directory;
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
}

async function main(root) {
    if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) {
        throw new Error('Cypress source builds require Linux x64 or arm64');
    }
    const upstream = createRequire(path.join(root, 'package.json'));
    const version = upstream('./packages/electron').getElectronVersion();
    const {Metadata} = upstream('./tooling/electron-mksnapshot/dist/metadata');
    await prepareElectron(root, {
        version, platform: process.platform, arch: process.arch,
        downloadArtifact: upstream('@electron/get').downloadArtifact,
        extractZip: upstream('extract-zip'),
        snapshot: upstream('./tooling/electron-mksnapshot/dist/config').config,
        writeMetadata: () => new Metadata(version).write()
    });
}
module.exports = {retryDownload, prepareElectron};
if (require.main === module) main(path.resolve(process.argv[2])).catch(error => {
    console.error(error); process.exitCode = 1;
});
