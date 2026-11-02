// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');
const source = {version: '16.2.1', commit: '519d66d80b0ae1bd3f9581665ce69473b82af59b', buildNode: 'v24.15.0'};
function provenance(architecture = process.arch) {
    return {...source, distribution: 'MageLens source build', repository: 'https://github.com/cypress-io/cypress', architecture,
        patchSha256: createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'runner-fixes.patch'))).digest('hex')};
}
function verifyInstalled(file = `/opt/cypress/${source.version}/Cypress/magelens-build.json`) {
    try {
        const actual = JSON.parse(fs.readFileSync(file));
        assert.deepEqual(actual, provenance());
        return actual;
    } catch (cause) {
        throw new Error('The Cypress runner is missing or stale. Rerun ./install.sh with your saved platform, theme and runner flags.', {cause});
    }
}
module.exports = {source, provenance, verifyInstalled};
if (require.main === module) {
    if (process.argv[2]) {
        if (!(process.argv[2] in source)) throw new Error('Unknown Cypress source input');
        console.log(source[process.argv[2]]);
    } else console.log(JSON.stringify(provenance(), null, 2));
}
