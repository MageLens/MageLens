// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {covered} = require('./outcomes.cjs');

module.exports = [
    [['condition-acl', 'condition-aclResource', 'condition-ifconfig', 'visibility'], {
        'condition-allowed': covered,
        'condition-denied': covered,
    }],
    [['visibility-argument', 'visibility-argument-name'], {
        'condition-argument-applied': covered,
        'condition-argument-unconsumed': "This rule retrieved its arguments from another XML condition key.",
    }],
    [['visibility-class'], {
        'condition-class-selected': covered,
    }],
    [['visibility'], {
        'condition-failed': "The native visibility rule call failed before returning a decision.",
    }],
    [['visibility-name'], {
        'condition-name-applied': covered,
        'condition-name-unused': "The native rule used another condition key to retrieve its arguments.",
    }],
    [[
        'visibility', 'visibility-argument', 'visibility-argument-name', 'visibility-class',
        'visibility-name',
    ], {
        'condition-unconfirmed': "The custom condition source lacks a unique native composite, rule-key or bounded argument binding.",
    }],
    [['block-display', 'container-display', 'reference', 'reference-name'], {
        'display-allowed': covered,
        'display-denied': covered,
    }],
    [['block-display', 'reference', 'reference-name'], {
        'display-empty-ignored': "The native block generator treats the original zero display spelling as empty and skips the structural attribute. Container display processing has different semantics.",
    }],
];
