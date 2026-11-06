// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {kinds, inputs, validateManifest} = require('../../bin/image-inputs.cjs');
const read = file => JSON.parse(fs.readFileSync(file));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function manifest(directory) {
    const images = Object.fromEntries(kinds.map(kind => {
        const entry = read(path.join(directory, kind, 'entry.json'));
        assert.equal(entry.kind, kind);
        assert.equal(entry.sha, process.env.CI_SHA, 'Wrong image candidate');
        assert.equal(entry.run, process.env.GITHUB_RUN_ID, 'Wrong image run');
        assert.equal(entry.attempt, process.env.GITHUB_RUN_ATTEMPT, 'Wrong image attempt');
        assert.equal(entry.inputs, inputs(process.cwd(), kind), 'Stale image inputs');
        return [kind, {inputs: entry.inputs, digest: entry.digest}];
    }));
    return validateManifest({schema: 1, platform: 'linux/amd64', version: read('package.json').version, images});
}
module.exports = {manifest};
if (require.main === module) {
    const [action, ...args] = process.argv.slice(2);
    if (action === 'entry') {
        const [kind, fingerprint, digest, file] = args;
        write(file, {kind, inputs: fingerprint, digest, sha: process.env.CI_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT});
    } else if (action === 'manifest') write(args[1], manifest(args[0]));
    else if (action === 'verify') {
        const expected = validateManifest(read(args[1]));
        assert.equal(expected.version, read('package.json').version);
        for (const kind of kinds) {
            assert.equal(expected.images[kind].inputs, inputs(process.cwd(), kind));
            const raw = execFileSync('skopeo', ['inspect', '--raw', `oci-archive:${args[0]}/${kind}/image.tar`]);
            assert.equal('sha256:' + createHash('sha256').update(raw).digest('hex'), expected.images[kind].digest);
        }
    } else throw new Error('Unknown image evidence command');
}
