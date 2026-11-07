// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

function regularTree(root) {
    const stat = fs.lstatSync(root);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Unsupported state file: ${root}`);
    if (stat.isDirectory()) for (const name of fs.readdirSync(root)) regularTree(path.join(root, name));
}
function clone(source, destination) {
    regularTree(source);
    if (fs.existsSync(destination)) throw new Error('Clone destination already exists');
    execFileSync('cp', ['-a', '--reflink=always', '--', source, destination], {stdio: 'pipe'});
}
function probe(root) {
    if (fs.realpathSync(root) !== path.resolve(root)) throw new Error('Storage path must not contain symlinks');
    const directory = fs.mkdtempSync(path.join(root, '.p0-probe-'));
    try {
        const original = path.join(directory, 'original'), copy = path.join(directory, 'copy');
        fs.writeFileSync(original, Buffer.alloc(65536, 17));
        clone(original, copy);
        const fd = fs.openSync(copy, 'r+');
        try { fs.writeSync(fd, Buffer.from([42]), 0, 1, 0); } finally { fs.closeSync(fd); }
        if (fs.readFileSync(original)[0] !== 17 || fs.readFileSync(copy)[0] !== 42) throw new Error('CoW isolation failed');
    } catch (error) {
        throw new Error('P0 requires working filesystem reflinks (XFS with reflink or Btrfs); no full-copy checkpoint fallback.', {cause: error});
    } finally { fs.rmSync(directory, {recursive: true}); }
}
function replace(source, destination, ownerRoot) {
    const root = fs.realpathSync(ownerRoot), parent = fs.realpathSync(path.dirname(destination));
    if (!parent.startsWith(root + path.sep) || fs.lstatSync(destination).isSymbolicLink()) throw new Error('Refusing unowned state replacement');
    regularTree(source);
    fs.rmSync(destination, {recursive: true});
    clone(source, destination);
}
module.exports = {clone, probe, replace, regularTree};
