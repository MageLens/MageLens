// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const releaseImages = require('../bin/image-inputs.cjs');
const {descriptor} = require('./runners/index.cjs');
function describe(root, kind) {
    const adapter = kind === 'orchestrator' ? null : descriptor(kind);
    const files = ['branching/images.cjs'];
    function visit(directory) {
        for (const entry of fs.readdirSync(path.join(root, directory), {withFileTypes: true})) {
            const file = `${directory}/${entry.name}`;
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile()) files.push(file);
            else throw new Error(`Unsupported image input: ${file}`);
        }
    }
    if (!adapter) {
        files.push(...['Dockerfile', '.dockerignore', 'Cargo.toml', 'Cargo.lock'].map(file => `branching/planner/${file}`));
        visit('branching/planner/src'); visit('branching/planner/tests');
    } else files.push('branching/runners/index.cjs', `${adapter.context}/Dockerfile`);
    const hash = createHash('sha256').update(kind + '\0');
    for (const file of files.sort()) hash.update(file + '\0').update(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')).update('\0');
    const baseInputs = adapter ? releaseImages.inputs(root, adapter.baseImage) : null;
    if (adapter) hash.update(baseInputs).update(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
    return {kind, fingerprint: hash.digest('hex'), image: adapter?.image ?? 'orchestrator', context: adapter?.context ?? 'branching/planner', baseInputs};
}
async function base(root, runner) {
    const adapter = descriptor(runner);
    const selected = await releaseImages.resolve(root, {MAGELENS_IMAGE_PLATFORM: 'linux/amd64', MAGELENS_RUNNER: runner});
    if (!selected[adapter.baseImage]) throw new Error('No qualified browser base image matches this checkout. Publish matching tooling images before building this adapter.');
    return selected[adapter.baseImage].image;
}
module.exports = {describe, base};
if (require.main === module) {
    const [operation, kind] = process.argv.slice(2);
    if (operation === 'describe') { const d = describe(process.cwd(), kind); console.log([d.fingerprint, d.image, d.context].join('\t')); }
    else if (operation === 'base') base(process.cwd(), kind).then(console.log).catch(error => { console.error(error.message); process.exitCode = 1; });
    else throw new Error('Usage: node branching/images.cjs describe KIND | base RUNNER');
}
