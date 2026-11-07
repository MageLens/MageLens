// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const fs = require('node:fs');
const {createHash} = require('node:crypto');
function canonical(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        return (
            '{' +
            Object.keys(value)
                .sort()
                .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
                .join(',') +
            '}'
        );
    }
    throw new Error(messages.identityValuesMustBeFiniteJsonData);
}
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
function fileDigest(file) {
    const hash = createHash('sha256'),
        buffer = Buffer.alloc(1024 * 1024),
        fd = fs.openSync(file, 'r');
    try {
        let size;
        while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)))
            hash.update(buffer.subarray(0, size));
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}
function implementationDigest(files) {
    return digest(files.map((file) => fileDigest(file)));
}
module.exports = {canonical, digest, fileDigest, implementationDigest};
