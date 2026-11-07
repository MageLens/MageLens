// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const messages = require('./configs/messages.cjs');

const fs = require('node:fs');
const path = require('node:path');
const {clone, replace, probe} = require('./storage.cjs');
const {files} = require('./configs/runtime.cjs');

function validateMutablePaths(paths, directory) {
    const roots = Object.entries(paths || {});
    if (!roots.length) throw new Error(messages.backendSuppliedNoMutableState);
    const owner = fs.realpathSync(directory) + path.sep;
    for (const [name, root] of roots) {
        if (!/^[a-z][a-z0-9-]*$/.test(name) || !fs.realpathSync(root).startsWith(owner)) {
            throw new Error(messages.mutableStateMustBeOwnedByThisRun);
        }
        probe(root);
    }
}

function captureState(paths, directory, browser) {
    for (const [name, source] of Object.entries(paths)) clone(source, path.join(directory, name));
    fs.writeFileSync(path.join(directory, files.browser), JSON.stringify(browser), {mode: 0o600});
}

function restoreState(paths, directory, owner) {
    for (const [name, destination] of Object.entries(paths)) {
        replace(path.join(directory, name), destination, owner);
    }
    return JSON.parse(fs.readFileSync(path.join(directory, files.browser), 'utf8'));
}

module.exports = {validateMutablePaths, captureState, restoreState};
