// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const failure of ['', 'image', 'network']) {
    test(`host probe separates image preparation and preserves required assertions: ${failure || 'success'}`, () => {
        const calls = [];
        let report;
        const fakeProcess = {platform: 'linux', arch: 'x64', env: {RUNNER_OS: 'Linux', GITHUB_SHA: 'candidate'}};
        vm.runInNewContext(fs.readFileSync(require.resolve('./ci/probe.cjs'), 'utf8'), {
            process: fakeProcess, console: {log() {}}, require(name) {
                if (name === 'node:fs') return {mkdirSync() {}, writeFileSync(file, text) {report = JSON.parse(text);}};
                if (name === 'node:os') return {release: () => 'test', totalmem: () => 16 * 2 ** 30};
                if (name === 'node:child_process') return {spawnSync(command, args, options) {
                    calls.push({command, args: [...args], timeout: options.timeout});
                    const image = args.some(arg => arg.includes('docker pull'));
                    const network = args.includes('tests/ci/probe-linux-containers.sh');
                    return {status: failure === 'image' && image || failure === 'network' && network ? 1 : 0,
                        stdout: command === 'docker' && args[0] === 'info' ? 'linux/x86_64\n' : 'ok\n'};
                }};
                throw new Error(`Unexpected dependency: ${name}`);
            }
        });
        const image = calls.find(call => call.args.some(arg => arg.includes('docker pull')));
        assert.equal(image.timeout, 300000);
        const network = calls.find(call => call.args.includes('tests/ci/probe-linux-containers.sh'));
        if (failure === 'image') assert.equal(network, undefined);
        else assert.equal(network.timeout, 120000);
        assert.equal(report.passed, !failure);
        assert.equal(fakeProcess.exitCode, failure ? 1 : 0);
    });
}
