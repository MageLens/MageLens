// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
function checkSize(directory, limit = 5 * 1024 * 1024) {
    let bytes = 0;
    function visit(target) {
        const stat = fs.lstatSync(target);
        if (stat.isDirectory()) for (const name of fs.readdirSync(target)) visit(path.join(target, name));
        else if (stat.isFile()) bytes += stat.size;
        else throw new Error('Artifacts must contain only regular files and directories');
        if (bytes > limit) throw new Error(`Artifact exceeds ${limit} bytes; upload blocked`);
    }
    visit(directory);
    return bytes;
}
module.exports = {checkSize};
if (require.main === module) console.log(`Artifact size: ${checkSize(process.argv[2])} bytes (5 MiB limit).`);
