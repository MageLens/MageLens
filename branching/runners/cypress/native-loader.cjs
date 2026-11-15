// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

module.exports = function checkpointLoader(source, inputMap) {
    const entries = this.getOptions().entries.filter(entry => entry.file === this.resourcePath);
    const stateAccess = (this.getOptions().stateAccess ?? []).filter(entry=>entry.file===this.resourcePath);
    if (!entries.length && !stateAccess.length) return this.callback(null, source, inputMap);
    if (inputMap) throw new Error('Native checkpoint instrumentation must precede source compilation');
    const result = !entries.length ? require('./native-state-transform.cjs').transform(source, this.resourcePath, stateAccess)
        : require('./native-transform.cjs').transform(source, this.resourcePath, entries, this.getOptions().browserState, stateAccess);
    this.callback(null, result.code, result.map);
};
