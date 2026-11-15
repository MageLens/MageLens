// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Discovery supplies identities, never replacement bytes. Read dependencies
// from explicitly selected local roots and reject changes before assessment.
function discoveryContext(row, {root, dependencyRoots = []}) {
    if (row.discoveryOnly !== true || !Array.isArray(row.files) || !Array.isArray(row.snapshot?.sourceArchive))
        throw Error('Expected source-backed discovery-only evidence');
    const roots = [root, ...dependencyRoots].map(directory => fs.realpathSync(directory));
    const sources = new Map();
    for (const entry of row.files) {
        if (!path.isAbsolute(entry.file) || !/^[a-f0-9]{64}$/.test(entry.hash))
            throw Error('Invalid discovery file identity');
        const file = path.resolve(entry.file);
        if (!roots.some(directory => file.startsWith(directory + path.sep)) || fs.realpathSync(file) !== file)
            throw Error('Discovery file escapes selected source roots');
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        let bytes;
        try {
            if (!fs.fstatSync(fd).isFile()) throw Error('Discovery source is not a regular file');
            bytes = fs.readFileSync(fd);
        } finally { fs.closeSync(fd); }
        if (digest(bytes) !== entry.hash) throw Error('Discovery source changed');
        sources.set(entry.hash, bytes.toString('utf8'));
    }
    const names = new Set();
    return row.snapshot.sourceArchive.filter(entry => entry.name?.startsWith('context/')).map(entry => {
        if (entry.role !== 'context' || names.has(entry.name) || !sources.has(entry.sha256) ||
            entry.name.split('/').some(part => !part || part === '.' || part === '..'))
            throw Error('Discovery context has no unique verified source');
        names.add(entry.name);
        return {name:entry.name, role:'context', source:sources.get(entry.sha256)};
    });
}

module.exports = {discoveryContext};
