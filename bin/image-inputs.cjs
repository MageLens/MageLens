// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const kinds = ['php', 'runner-cypress', 'runner-playwright'];
const digestPattern = /^sha256:[a-f0-9]{64}$/;
function inputs(root, kind) {
    if (!kinds.includes(kind)) throw new Error('Unknown image kind');
    const files = ['dependencies.yaml', '.dockerignore', 'bin/image-inputs.cjs'];
    if (kind === 'php') files.push('bin/build-php-image', ...['Dockerfile', 'composer.json', 'composer.lock', 'coverage.ini', 'collect.php', 'collection.php', 'configure-user.sh'].map(file => `docker/php/${file}`));
    else {
        const visit = directory => {
            for (const entry of fs.readdirSync(path.join(root, directory), {withFileTypes: true})) {
                const file = `${directory}/${entry.name}`;
                if (entry.isDirectory()) visit(file);
                else if (entry.isFile()) files.push(file);
                else throw new Error(`Unsupported image input: ${file}`);
            }
        };
        visit('docker/runner');
    }
    const hash = createHash('sha256').update(kind + '\0');
    // Git may check text out with CRLF on Windows; Docker recipes are text inputs.
    for (const file of files.sort()) hash.update(file + '\0').update(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')).update('\0');
    return hash.digest('hex');
}
const platforms = ['linux/amd64', 'linux/arm64'];
function platformImages(manifest) {
    return manifest.platforms || {[manifest.platform]: manifest.images};
}
function validateManifest(manifest) {
    if (!manifest || manifest.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.version)
        || (manifest.expired !== undefined && typeof manifest.expired !== 'boolean')) throw new Error('Invalid image manifest');
    if (manifest.expired === true) return manifest;
    const entries = platformImages(manifest);
    const expected = manifest.platforms ? platforms : ['linux/amd64'];
    if (manifest.platform !== 'linux/amd64') throw new Error('Invalid image manifest platform');
    if (!entries || Object.keys(entries).sort().join() !== [...expected].sort().join()) throw new Error('Invalid image manifest platforms');
    for (const platform of expected) for (const kind of kinds) {
        const entry = entries[platform]?.[kind];
        if (!entry || !/^[a-f0-9]{64}$/.test(entry.inputs) || !digestPattern.test(entry.digest)) throw new Error(`Invalid ${platform} ${kind} image provenance`);
    }
    if (manifest.platforms && kinds.some(kind => manifest.images?.[kind]?.inputs !== entries['linux/amd64'][kind].inputs || manifest.images?.[kind]?.digest !== entries['linux/amd64'][kind].digest)) throw new Error('Invalid legacy image provenance');
    return manifest;
}
function select(root, manifest, platform, runner) {
    validateManifest(manifest);
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
    if (manifest.expired === true) {
        if (manifest.version !== version) throw new Error('Expired image manifest version mismatch');
        return Object.fromEntries(['php', `runner-${runner}`].map(kind => [kind, null]));
    }
    return Object.fromEntries(['php', `runner-${runner}`].map(kind => {
        const entry = platformImages(manifest)[platform]?.[kind];
        return [kind, manifest.version === version && entry?.inputs === inputs(root, kind)
            ? {...entry, image: `ghcr.io/magelens/${kind}@${entry.digest}`} : null];
    }));
}
async function resolve(root, env = process.env, request = fetch) {
    const {version} = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
    const response = await request(`https://github.com/MageLens/MageLens/releases/download/v${version}/images.json`, {signal: AbortSignal.timeout(60000)});
    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`Release image lookup failed (${response.status}); retry or use --build-from-source.`);
    return select(root, await response.json(), env.MAGELENS_IMAGE_PLATFORM, env.MAGELENS_RUNNER);
}
module.exports = {inputs, validateManifest, select, resolve, kinds, digestPattern, platforms, platformImages};
if (require.main === module) {
    if (process.argv[2] === 'inputs') console.log(inputs(process.cwd(), process.argv[3]));
    else if (process.argv[2] === 'resolve') resolve(process.cwd()).then(selected => {
        fs.writeFileSync('.runtime/prebuilt-images.json', JSON.stringify(selected, null, 2) + '\n');
    }).catch(error => {console.error(error.message); process.exitCode = 1;});
    else throw new Error('Usage: node bin/image-inputs.cjs inputs KIND | resolve');
}
