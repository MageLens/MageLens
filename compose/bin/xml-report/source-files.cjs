// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {XML_SOURCE_PATH} = require('./regex.cjs');

function assertSourcePath(file) {
    assert.match(file, XML_SOURCE_PATH, 'Invalid XML source path');
    assert.ok(!file.split('/').some(part => !part || part === '..' || part === '.'), 'Invalid XML source segment');
}

function readSources(files, sourceRoot = 'src') {
    const root = fs.realpathSync(sourceRoot);
    return Object.fromEntries(files.map(({path: file}) => {
        assertSourcePath(file);
        const filename = path.join(root, file);
        assert.equal(fs.realpathSync(filename), filename, `Symlinked XML source: ${file}`);
        return [file, fs.readFileSync(filename)];
    }));
}

module.exports = {assertSourcePath, readSources};
