// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const repository = 'MageLens/MageLens';
const repositoryUrl = `https://github.com/${repository}`;
const imageRegistry = `ghcr.io/${repository.split('/')[0].toLowerCase()}`;
const kinds = ['php', 'runner-cypress', 'runner-playwright'];
const legacyPlatform = 'linux/amd64';
const platforms = [legacyPlatform, 'linux/arm64'];
const manifestFilename = 'images.json';
// Protocol 1 promises version-specific lookup, intentional-expiration fallback,
// and revalidation after a selected image disappears during installation.
const expirationProtocol = 1;
const releaseVersionPattern = /^\d+\.\d+\.\d+$/;
const releaseTagPattern = /^v\d+\.\d+\.\d+$/;
const inputHashPattern = /^[a-f0-9]{64}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const windowsLineEndingPattern = /\r\n/g;
const normalizeLineEndings = source => source.replace(windowsLineEndingPattern, '\n');
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
    for (const file of files.sort()) {
        const source = normalizeLineEndings(fs.readFileSync(path.join(root, file), 'utf8'));
        hash.update(file + '\0').update(source).update('\0');
    }
    return hash.digest('hex');
}
function platformImages(manifest) {
    return manifest.platforms || {[manifest.platform]: manifest.images};
}
function timestampMillis(timestamp, message = 'Invalid manifest retirement time') {
    // Round-tripping rejects calendar dates that Date.parse normalizes.
    const parsed = typeof timestamp === 'string' && utcTimestampPattern.test(timestamp) ? Date.parse(timestamp) : NaN;
    const valid = Number.isFinite(parsed)
        && new Date(parsed).toISOString().replace('.000Z', 'Z') === timestamp.replace('.000Z', 'Z');
    if (!valid) throw new Error(message);
    return parsed;
}
function validateManifest(manifest) {
    if (!manifest || manifest.schema !== 1 || !releaseVersionPattern.test(manifest.version)
        || (manifest.expired !== undefined && typeof manifest.expired !== 'boolean')
        || (manifest.expirationProtocol !== undefined && (!Number.isSafeInteger(manifest.expirationProtocol) || manifest.expirationProtocol < 1))) throw new Error('Invalid image manifest');
    if (manifest.expiredAt !== undefined || (manifest.expired === true && manifest.expirationProtocol === expirationProtocol)) {
        timestampMillis(manifest.expiredAt);
    }
    if (manifest.expired === true) return manifest;
    const entries = platformImages(manifest);
    const expected = manifest.platforms ? platforms : [legacyPlatform];
    if (manifest.platform !== legacyPlatform) throw new Error('Invalid image manifest platform');
    if (!entries || Object.keys(entries).sort().join() !== [...expected].sort().join()) throw new Error('Invalid image manifest platforms');
    for (const platform of expected) for (const kind of kinds) {
        const entry = entries[platform]?.[kind];
        if (!entry || !inputHashPattern.test(entry.inputs) || !digestPattern.test(entry.digest)) {
            throw new Error(`Invalid ${platform} ${kind} image provenance`);
        }
    }
    const legacyImagesMismatch = manifest.platforms && kinds.some(kind => {
        const legacy = manifest.images?.[kind];
        const native = entries[legacyPlatform][kind];
        return legacy?.inputs !== native.inputs || legacy?.digest !== native.digest;
    });
    if (legacyImagesMismatch) throw new Error('Invalid legacy image provenance');
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
            ? {...entry, image: `${imageRegistry}/${kind}@${entry.digest}`} : null];
    }));
}
async function lookupManifest(root, request, allowMissing) {
    const {version} = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    if (!releaseVersionPattern.test(version)) throw new Error('Invalid release version');
    const response = await request(`${repositoryUrl}/releases/download/v${version}/${manifestFilename}`, {
        signal: AbortSignal.timeout(60000), cache: 'no-store', headers: {'Cache-Control': 'no-cache'}
    });
    if (response.status === 404 && allowMissing) return null;
    if (!response.ok) throw new Error(`Release image lookup failed (${response.status}); retry or use --build-from-source.`);
    return {version, manifest: validateManifest(await response.json())};
}
async function resolve(root, env = process.env, request = fetch) {
    const result = await lookupManifest(root, request, true);
    return result ? select(root, result.manifest, env.MAGELENS_IMAGE_PLATFORM, env.MAGELENS_RUNNER) : {};
}
async function confirmExpiration(root, env = process.env, request = fetch) {
    const {version, manifest} = await lookupManifest(root, request, false);
    if (manifest.version !== version || manifest.expired !== true) {
        throw new Error('Missing release image without confirmed intentional expiration');
    }
    return select(root, manifest, env.MAGELENS_IMAGE_PLATFORM, env.MAGELENS_RUNNER);
}
module.exports = {
    inputs, validateManifest, select, resolve, confirmExpiration, kinds, platforms, legacyPlatform, platformImages,
    repository, repositoryUrl, imageRegistry, manifestFilename, releaseVersionPattern, releaseTagPattern,
    digestPattern, normalizeLineEndings, expirationProtocol, timestampMillis
};
if (require.main === module) {
    if (process.argv[2] === 'inputs') console.log(inputs(process.cwd(), process.argv[3]));
    else if (['resolve', 'confirm-expiration'].includes(process.argv[2])) {
        const action = process.argv[2] === 'resolve' ? resolve : confirmExpiration;
        action(process.cwd()).then(selected => {
            fs.writeFileSync('.runtime/prebuilt-images.json', JSON.stringify(selected, null, 2) + '\n');
        }).catch(error => {console.error(error.message); process.exitCode = 1;});
    } else throw new Error('Usage: node bin/image-inputs.cjs inputs KIND | resolve | confirm-expiration');
}
