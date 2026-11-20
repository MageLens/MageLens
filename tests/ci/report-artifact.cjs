// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {gzipSync, gunzipSync} = require('node:zlib');

const snapshotFile = 'equivalence.json.gz';
const xmlFile = 'xml/coverage-summary.json.gz';

function writeProjection(directory, snapshot) {
    fs.mkdirSync(path.join(directory, 'xml'), {recursive: true});
    fs.writeFileSync(path.join(directory, xmlFile), gzipSync(JSON.stringify(snapshot.xml)));
    fs.writeFileSync(path.join(directory, snapshotFile), gzipSync(JSON.stringify(snapshot)));
}

function readProjection(directory, name) {
    return JSON.parse(gunzipSync(fs.readFileSync(path.join(directory, name))));
}

module.exports = {snapshotFile, xmlFile, writeProjection, readProjection};
