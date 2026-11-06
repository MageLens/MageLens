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
function validateManifest(manifest) {
    if (manifest.schema !== 1 || manifest.platform !== 'linux/amd64' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid image manifest');
    for (const kind of kinds) {
        const entry = manifest.images?.[kind];
        if (!entry || !/^[a-f0-9]{64}$/.test(entry.inputs) || !digestPattern.test(entry.digest)) throw new Error(`Invalid ${kind} image provenance`);
    }
    return manifest;
}
function select(root, manifest, platform, runner, registry = 'ghcr.io/magelens') {
    validateManifest(manifest);
    if (!/^(ghcr\.io\/[a-z0-9][a-z0-9/_-]*|localhost:[0-9]+\/[a-z0-9/_-]+)$/.test(registry)) throw new Error('Invalid image registry');
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
    return Object.fromEntries(['php', `runner-${runner}`].map(kind => {
        const entry = manifest.images[kind];
        return [kind, manifest.version === version && manifest.platform === platform && entry.inputs === inputs(root, kind)
            ? {...entry, image: `${registry}/${kind}@${entry.digest}`} : null];
    }));
}
async function resolve(root, env = process.env) {
    let manifest;
    if (env.MAGELENS_IMAGE_MANIFEST) {
        manifest = JSON.parse(fs.readFileSync(path.join(root, '.runtime/candidate-images.json')));
    } else {
        const {version} = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
        if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
        const response = await fetch(`https://github.com/MageLens/MageLens/releases/download/v${version}/images.json`, {signal: AbortSignal.timeout(60000)});
        if (response.status === 404) return {};
        if (!response.ok) throw new Error(`Release image lookup failed (${response.status}); retry or use --build-from-source.`);
        manifest = await response.json();
    }
    return select(root, manifest, env.MAGELENS_IMAGE_PLATFORM, env.MAGELENS_RUNNER, env.MAGELENS_IMAGE_REGISTRY);
}
module.exports = {inputs, validateManifest, select, kinds, digestPattern};
if (require.main === module) {
    if (process.argv[2] === 'inputs') console.log(inputs(process.cwd(), process.argv[3]));
    else if (process.argv[2] === 'resolve') resolve(process.cwd()).then(selected => {
        fs.writeFileSync('.runtime/prebuilt-images.json', JSON.stringify(selected, null, 2) + '\n');
    }).catch(error => {console.error(error.message); process.exitCode = 1;});
    else throw new Error('Usage: node bin/image-inputs.cjs inputs KIND | resolve');
}
