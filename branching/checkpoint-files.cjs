// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const config = require('./configs/runtime.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {fileDigest} = require('./identity.cjs');
function sync(file) {
    const fd = fs.openSync(file, 'r');
    try {
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}
function write(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    sync(file);
}
function inventory(directory, relative = '') {
    return fs
        .readdirSync(path.join(directory, relative))
        .sort()
        .flatMap((name) => {
            const key = path.join(relative, name),
                file = path.join(directory, key),
                stat = fs.lstatSync(file);
            if (stat.isSymbolicLink()) throw new Error(messages.checkpointSymlinksAreUnsupported);
            if (stat.isDirectory()) return inventory(directory, key);
            if (!stat.isFile()) throw new Error(messages.checkpointMustContainRegularFiles);
            return [
                {path: key, bytes: stat.size, allocatedBytes: stat.blocks * 512, sha256: fileDigest(file)}
            ];
        });
}
function allocatedBytes(directory) {
    return fs.readdirSync(directory).reduce((total, name) => {
        const file = path.join(directory, name),
            stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
            throw new Error(messages.unexpectedCheckpointFileType);
        return total + (stat.isDirectory() ? allocatedBytes(file) : stat.blocks * 512);
    }, 0);
}

function cleanup(directory, run) {
    if (fs.lstatSync(directory).isSymbolicLink() || !/^run-/.test(path.basename(directory)))
        throw new Error(messages.unownedRunDirectory);
    const owner = JSON.parse(fs.readFileSync(path.join(directory, config.files.owner)));
    if (owner.kind !== config.checkpoint.ownerKind || owner.run !== run)
        throw new Error(messages.unownedRunDirectory);
    fs.rmSync(directory, {recursive: true});
}
module.exports = {sync, write, inventory, allocatedBytes, cleanup};
