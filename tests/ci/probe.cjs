// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const output = process.env.CI_REPORT_DIR || 'ci-reports';
fs.mkdirSync(output, {recursive: true});
const report = {sha: process.env.CI_SHA || process.env.GITHUB_SHA, host: process.env.RUNNER_OS, image: process.env.ImageOS,
    imageVersion: process.env.ImageVersion, architecture: process.arch, release: os.release(),
    runtime: process.env.CI_HOST_RUNTIME || 'native', memoryGiB: Math.round(os.totalmem() / 2 ** 30), checks: {}, passed: false};
function run(name, command, args) {
    const result = spawnSync(command, args, {encoding: 'utf8', timeout: name === 'local-vm-start' ? 600000 : 120000, env: {...process.env, MSYS_NO_PATHCONV: '1'}});
    report.checks[name] = {status: result.status, output: `${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`.slice(-16000)};
    return report.checks[name];
}
try {
    run('bash', 'bash', ['-c', 'set -euo pipefail; printf "Bash %s\\n" "$BASH_VERSION"; for tool in git tar wget; do command -v "$tool" || exit 1; done; uname -a; df -Pk . "${MAGELENS_TEST_TMPDIR:-/tmp}"']);
    if (process.platform === 'win32') {
        run('wsl', 'wsl.exe', ['--status']);
        run('wsl-install', 'wsl.exe', ['--install', '--distribution', 'Ubuntu-24.04', '--no-launch']);
        run('wsl-boot', 'wsl.exe', ['--distribution', 'Ubuntu-24.04', '--user', 'root', '--exec', '/bin/uname', '-a']);
        run('virtualization', 'powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Processor | Select-Object Name,VirtualizationFirmwareEnabled,SecondLevelAddressTranslationExtensions | ConvertTo-Json; Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform | Select-Object FeatureName,State | ConvertTo-Json; Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V | Select-Object FeatureName,State | ConvertTo-Json']);
    }
    if (process.platform === 'darwin') {
        run('virtualization', 'sysctl', ['kern.hv_support', 'hw.optional.arm64']);
        run('vm-tools', 'bash', ['-c', 'set -e\ncolima version\nlimactl --version\nqemu-system-aarch64 --version']);
        // Standard ARM64 hosts expose no hypervisor. QEMU uses software emulation;
        // the full harness must still pass on this actual macOS host.
        run('local-vm-start', 'colima', ['start', '--vm-type', 'qemu', '--cpu', '2', '--memory', '5', '--disk', '40']);
    }
    run('docker', 'docker', ['version']);
    const info = run('engine', 'docker', ['info', '--format', '{{.OSType}}/{{.Architecture}}']);
    const compose = run('compose', 'docker', ['compose', 'version', '--short']);
    if (info.status !== 0 || !info.output.startsWith('linux/')) throw new Error('A working local Linux Docker engine is required; host mount/network checks cannot run.');
    if (compose.status !== 0) throw new Error('Docker Compose unavailable.');
    const mounts = run('mounts-network', 'bash', ['tests/ci/probe-linux-containers.sh']);
    if (mounts.status !== 0 || report.checks.bash.status !== 0) throw new Error('Bash, Compose, filesystem or networking validation failed.');
    report.passed = true;
} catch (error) {
    report.blocker = error.message;
} finally {
    fs.writeFileSync(`${output}/feasibility.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `## ${report.host} feasibility\n\n${report.passed ? 'PASS: Linux containers, mounts and networking.' : `BLOCKED: ${report.blocker}`}\n`);
    process.exitCode = report.passed ? 0 : 1;
}
