// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {covered} = require('./outcomes.cjs');

module.exports = [
    [['action', 'action-method', 'reference', 'reference-name'], {
        'action-ambiguous': "Multiple scheduled actions match the native method and arguments; the executed declaration could not be identified.",
        'action-completion-failed': "Native action generation failed after argument evaluation completed. This boundary cannot establish method body entry, successful call completion or partial side effects.",
        'action-evaluation-failed': "Native action generation failed during argument evaluation. No call completion or method body execution is established.",
        'action-executed': covered,
        'action-origin-unconfirmed': "The effective native process action snapshot did not establish the original source of this call.",
    }],
    [['action-argument'], {
        'action-argument-ambiguous': "Multiple scheduled actions supplied matching arguments, preventing a unique original parameter origin.",
        'action-argument-applied': covered,
        'action-argument-evaluated': covered,
        'action-argument-evaluation-incomplete': "The native action argument batch failed. This boundary does not establish which individual values finished evaluation before the failure.",
    }],
    [['action-argument-name'], {
        'action-argument-name-ambiguous': "Multiple original actions can supply this parsed argument key and position. The native call does not identify one original operand.",
        'action-argument-name-applied': covered,
        'action-argument-name-evaluated': covered,
        'action-argument-name-evaluation-incomplete': "The native action argument batch failed before a complete evaluated key map was observed.",
        'action-argument-name-origin-unconfirmed': "The action argument interpreter handoff does not establish this original parser key for the call.",
    }],
    [['action-ifconfig'], {
        'action-condition-allowed': covered,
        'action-condition-ambiguous': "More than one native scheduled action has this guard path and scope. The observed decision cannot identify a unique original operand, including unmapped dynamic actions.",
        'action-condition-denied': covered,
        'action-condition-empty-ignored': "Native action generation short-circuits the empty or zero guard without consulting configuration. The independent action call retains its own evidence.",
        'action-condition-failed': "The attributed native configuration flag call failed before it returned a guard decision.",
        'action-condition-origin-unconfirmed': "The native action snapshot, generator, scheduled storage or original action list could not establish this guard operand. No value equality inference is made.",
        'action-condition-unobserved': "The original guard was supplied, but no uniquely attributable native scope decision or completed short-circuited call was observed.",
    }],
    [['action-item'], {
        'action-item-evaluated': covered,
    }],
    [['action-item-name'], {
        'action-item-name-applied': covered,
    }],
    [['action-item', 'action-item-name'], {
        'action-item-origin-unconfirmed': "The nested action array operand has no uniquely verified native evaluation.",
    }],
];
