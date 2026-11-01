// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const os = require('node:os');
const disk = fs.statfsSync(process.env.MAGELENS_TEST_TMPDIR || '/tmp');
let free = disk.bavail * disk.bsize / 2 ** 30;
if (process.env.MAGELENS_CI_HOST_PATH) {
    // WSL's sparse virtual disk capacity must not hide the Windows drive limit.
    const host = fs.statfsSync(process.env.MAGELENS_CI_HOST_PATH);
    free = Math.min(free, host.bavail * host.bsize / 2 ** 30);
}
console.log(`Available disk: ${free.toFixed(1)} GiB; memory: ${(os.totalmem()/2**30).toFixed(1)} GiB`);
if (free < 25 || os.totalmem() < 6 * 2 ** 30) throw new Error('Insufficient resources for one isolated installation');
