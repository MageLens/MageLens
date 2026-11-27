// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// The running test attempt (docs/coverage.md#test-attempts), shared by the support files.
let current = null;
module.exports = {currentAttempt: () => current, setAttempt: id => { current = id; }};
