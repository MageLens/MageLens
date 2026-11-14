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
        if (environment.MAGELENS_PREFIX_TIMING_BOUNDARY)
            command.push('--env', `MAGELENS_PREFIX_TIMING_BOUNDARY=${environment.MAGELENS_PREFIX_TIMING_BOUNDARY}`);
        if (environment.MAGELENS_PREFIX_SOURCE_STORE)
            command.push('--env', `MAGELENS_PREFIX_SOURCE_STORE=${environment.MAGELENS_PREFIX_SOURCE_STORE}`);
        for (const key of ['MAGELENS_PREFIX_MODEL', 'MAGELENS_PREFIX_MODEL_SHA256', 'MAGELENS_PREFIX_ENVIRONMENT', 'MAGELENS_PREDICTOR_BACKEND_STATE']) {
            if (environment[key]) command.push('--env', `${key}=${environment[key]}`);
        }
        return execFileSync('docker', [...command, container, 'magelens-plan', ...args], options);
    }
    throw new Error('Rust orchestration is not running. Start the run with --branching.');
}
module.exports = {planner};
