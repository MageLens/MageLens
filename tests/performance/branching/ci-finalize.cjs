// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
function finalize(directory, cleanup) {
    const file = path.join(directory, 'result.json');
    const result = JSON.parse(fs.readFileSync(file));
    result.storageCleanup = cleanup === 'success';
    if (!result.storageCleanup || result.installationCleanup !== true) result.status = 'cleanup-failed';
    fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
    return result;
}
module.exports = {finalize};
if (require.main === module) finalize(...process.argv.slice(2));
