// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
function fingerprint(root) {
    const hash = createHash('sha256');
    for (const file of ['package.json', 'package-lock.json']) hash.update(fs.readFileSync(path.join(root, file))).update('\0');
    const tarball = path.join(root, '.runtime/template-coverage.tgz');
    if (fs.existsSync(tarball)) hash.update(fs.readFileSync(tarball));
    return hash.digest('hex');
}
function synchronize(root = '/workspace', bundled = '/opt/magelens-dependencies', execute = execFileSync) {
    const target = path.join(root, 'node_modules');
    const marker = path.join(target, '.magelens-dependencies');
    const expected = fingerprint(root);
    // Include Node ABI/architecture so reused volumes cannot retain native modules.
    const identity = `${expected}:${process.platform}:${process.arch}:${process.versions.modules}`;
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === identity) return 'unchanged';
    fs.mkdirSync(target, {recursive: true});
    // Remove only entries of the dependency volume, never the mounted directory itself.
    for (const entry of fs.readdirSync(target)) fs.rmSync(path.join(target, entry), {recursive: true, force: true});
    if (fingerprint(bundled) === expected) {
        execute('tar', ['xzf', path.join(bundled, 'node_modules.tar.gz'), '-C', root], {stdio: 'inherit'});
    } else {
        execute('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: root, stdio: 'inherit'});
    }
    fs.writeFileSync(marker, identity);
    return fingerprint(bundled) === expected ? 'bundled' : 'installed';
}
module.exports = {fingerprint, synchronize};
if (require.main === module) console.log(`Runner dependencies: ${synchronize()}.`);
