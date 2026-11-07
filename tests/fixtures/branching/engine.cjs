// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Provider/recovery test harness only. Production callers use the AUTO-only engine.
module.exports = {...require('../../../branching/engine.cjs'),
    execute: require('../../../branching/execution-run.cjs').executePlan};
