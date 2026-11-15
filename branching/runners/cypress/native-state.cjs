// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

/* global Cypress */

// Support and spec files have separate module caches. Keep references on the
// runner instance so adapters address the original cells, not another import.
function registry() {
    const key = Symbol.for('magelens.native.state');
    return Cypress[key] ??= new Map();
}
function register(id, access) {
    if (registry().has(id)) throw new Error('Ambiguous native state instance');
    registry().set(id, access);
}
function access(id) {
    if (!registry().has(id)) throw new Error('Native state instance has not been initialized');
    return registry().get(id);
}
module.exports = {register, access};
