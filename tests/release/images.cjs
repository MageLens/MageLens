// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {kinds, inputs, validateManifest} = require('../../bin/image-inputs.cjs');
const read = file => JSON.parse(fs.readFileSync(file));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function manifest(directory, root = process.cwd(), env = process.env) {
    const images = Object.fromEntries(kinds.map(kind => {
        const entry = read(path.join(directory, `${kind}.json`));
        assert.equal(entry.kind, kind);
        assert.equal(entry.sha, env.RELEASE_SHA, 'Wrong release commit');
        assert.equal(entry.run, env.GITHUB_RUN_ID, 'Wrong release run');
        assert.equal(entry.attempt, env.GITHUB_RUN_ATTEMPT, 'Wrong release attempt');
        assert.equal(entry.inputs, inputs(root, kind), 'Stale image inputs');
        return [kind, {inputs: entry.inputs, digest: entry.digest}];
    }));
    return validateManifest({schema: 1, platform: 'linux/amd64', version: read(path.join(root, 'package.json')).version, images});
}
module.exports = {manifest};
if (require.main === module) {
    const [action, ...args] = process.argv.slice(2);
    if (action === 'record') {
        const [kind, fingerprint, digest, file] = args;
        write(file, {kind, inputs: fingerprint, digest, sha: process.env.RELEASE_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT});
    } else if (action === 'manifest') write(args[1], manifest(args[0]));
    else throw new Error('Unknown image manifest command');
}
