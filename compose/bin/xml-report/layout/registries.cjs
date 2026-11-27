// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {covered} = require('./outcomes.cjs');

module.exports = [
    [['page-type', 'page-type-id', 'page-type-label'], {
        'page-type-applied': covered,
    }],
    [['page-type-id', 'page-type-label'], {
        'page-type-read': covered,
    }],
    [['registry-entry', 'registry-id', 'registry-label'], {
        'registry-cache-unconfirmed': "This registry input lacks a verified native file-read lineage in the current request.",
        'registry-snapshot-returned': "The native API returned the whole registry map. Individual entry and label consumption is unobserved on that path.",
    }],
    [['registry-entry'], {
        'registry-entry-configured': covered,
        'registry-entry-consumed': covered,
    }],
    [['registry-id'], {
        'registry-id-consumed': covered,
    }],
    [['registry-label'], {
        'registry-label-consumed': covered,
        'registry-label-ignored': "The native label merge applied no replacement text and preserved the preceding label fragments.",
        'registry-label-unconfirmed': "The mixed-content label merge lacks complete native text assignment evidence.",
    }],
    [['page-type-id', 'page-type-label', 'registry-id', 'registry-label'], {
        'registry-overridden': "A later native registry write supplied the field used by the consumer.",
    }],
];
