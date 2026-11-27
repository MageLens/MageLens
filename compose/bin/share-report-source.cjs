// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {isCoverageExcluded} = require('./project.cjs');

function isCoverageSourcePath(file) {
    return typeof file === 'string'
        && /^(?:app\/code|app\/design\/(?:frontend|adminhtml)|vendor)\//.test(file)
        && /\.(?:php|phtml|html|js|xml)$/.test(file)
        && !/[\\\0]/.test(file)
        && file.split('/').every(part => part && part !== '.' && part !== '..')
        && !isCoverageExcluded(file);
}

function isShareablePath(file) {
    return isCoverageSourcePath(file) && !/[\x00-\x1f\x7f-\x9f<>:"|?*]/.test(file);
}

function createSourceReader(projectRoot, coverageDir) {
    const sourceRoot = path.join(fs.realpathSync(projectRoot), 'src');
    const inventoryPath = path.join(fs.realpathSync(coverageDir), 'run.json');
    if (fs.realpathSync(inventoryPath) !== inventoryPath || !fs.statSync(inventoryPath).isFile()) {
        throw new Error('Invalid coverage source inventory.');
    }
    const {roots, sources} = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    if (!Array.isArray(roots) || !sources || typeof sources !== 'object' || Array.isArray(sources)) {
        throw new Error('Missing coverage source inventory. Rerun coverage before including source.');
    }

    return file => {
        if (!isCoverageSourcePath(file) || !roots.some(root => file.startsWith(root + '/'))) {
            throw new Error('Source is outside the measured application scope.');
        }
        const key = 'src/' + file;
        if (!Object.hasOwn(sources, key) || !/^[0-9a-f]{64}$/.test(sources[key])) {
            throw new Error('Source is missing from the coverage inventory.');
        }
        const original = path.join(sourceRoot, file);
        if (fs.realpathSync(original) !== original) throw new Error('Symlinked coverage source is unsupported.');
        const fd = fs.openSync(original, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        try {
            if (!fs.fstatSync(fd).isFile()) throw new Error('Expected a regular coverage source file.');
            const bytes = fs.readFileSync(fd);
            if (createHash('sha256').update(bytes).digest('hex') !== sources[key]) {
                throw new Error('Original source has changed. Rerun coverage before including source.');
            }
            return bytes.toString('utf8');
        } finally {
            fs.closeSync(fd);
        }
    };
}

module.exports = {createSourceReader, isShareablePath};
