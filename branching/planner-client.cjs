// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {execFileSync} = require('node:child_process');
function planner(args, options = {}, environment = process.env) {
    const container = environment.MAGELENS_ORCHESTRATOR_CONTAINER;
    if (container) {
        if (!/^[a-f0-9]{64}$/.test(container)) throw new Error('Invalid orchestrator container identity');
        const command = ['exec', '-i'];
        if (environment.LLVM_PROFILE_FILE) command.push('--env', `LLVM_PROFILE_FILE=${environment.LLVM_PROFILE_FILE}`);
        return execFileSync('docker', [...command, container, 'magelens-plan', ...args], options);
    }
    throw new Error('Rust orchestration is not running. Start the run with --branching.');
}
module.exports = {planner};
