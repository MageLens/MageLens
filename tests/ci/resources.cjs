// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
function requireResources(resources) {
    for (const [name, capacity] of Object.entries(resources)) {
        if (!Number.isFinite(capacity.freeGiB) || !Number.isFinite(capacity.memoryGiB) ||
            capacity.freeGiB < 25 || capacity.memoryGiB < 6) {
            throw new Error(`Insufficient ${name} resources for one isolated installation`);
        }
    }
}
function checkResources() {
    const free = directory => {
        const disk = fs.statfsSync(directory);
        return disk.bavail * disk.bsize / 2 ** 30;
    };
    let hostFree = free(process.env.MAGELENS_TEST_TMPDIR || '/tmp');
    if (process.env.MAGELENS_CI_HOST_PATH) {
        // WSL's sparse virtual disk must not hide the Windows drive limit.
        hostFree = Math.min(hostFree, free(process.env.MAGELENS_CI_HOST_PATH));
    }
    const image = fs.readFileSync('dependencies.yaml', 'utf8').match(/^PLAYWRIGHT_RUNNER_IMAGE: "([^"]+)"$/m)?.[1];
    if (!image) throw new Error('Missing resource probe image pin');
    // The host probe already pulled this image. Read the engine filesystem and
    // memory from a disposable container, including Colima's local Linux VM.
    const engine = JSON.parse(execFileSync('docker', ['run', '--rm', '--network=none', '--pull=never', '--entrypoint', 'node', image, '-e',
        'const d=require("node:fs").statfsSync("/");console.log(JSON.stringify({freeGiB:d.bavail*d.bsize/2**30,memoryGiB:require("node:os").totalmem()/2**30}))'],
    {encoding: 'utf8', timeout: 30000, env: {...process.env, MSYS_NO_PATHCONV: '1'}}));
    const resources = {host: {freeGiB: hostFree, memoryGiB: os.totalmem() / 2 ** 30}, engine};
    console.log('Available resources:', JSON.stringify(resources));
    requireResources(resources);
}
module.exports = {requireResources};
if (require.main === module) checkResources();
