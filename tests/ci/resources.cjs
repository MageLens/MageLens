// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const os = require('node:os');
const disk = fs.statfsSync('/tmp');
const free = disk.bavail * disk.bsize / 2 ** 30;
console.log(`Available disk: ${free.toFixed(1)} GiB; memory: ${(os.totalmem()/2**30).toFixed(1)} GiB`);
if (free < 25 || os.totalmem() < 6 * 2 ** 30) throw new Error('Insufficient resources for one isolated installation');
