// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {covered} = require('./outcomes.cjs');

module.exports = [
    [['argument', 'reference', 'reference-name'], {
        'argument-application-unconfirmed': "Block creation passed evaluated values through an unverified implementation, plugin or hooked, magic or uninitialized lazy data storage. Their later application lacks verified original ownership.",
        'argument-applied': covered,
        'argument-field-access-unconfirmed': "A class with protected data access or a scoped closure can reach block data outside the observed native data accessors, or its implementation could not be inspected. Those accesses are not traced; earlier application remains proven, while equal values cannot establish original XML read lineage.",
        'argument-read': covered,
        'argument-replaced': "A runtime data write revoked this XML value origin before a later native getter could consume it.",
        'argument-storage-unconfirmed': "The block data property became hooked, unset, magic or subject to unverified lazy initialization. Original application evidence is retained; later reads lack verified XML lineage.",
    }],
    [['argument'], {
        'argument-evaluated': covered,
        'argument-identity-unconfirmed': "Value correlation is bounded to 1024 nodes, 32 nested levels and 64 KiB of string/key bytes; closed resources lack a supported identity.",
        'argument-mixed-origin': "The assembled argument retains multiple or unconfirmed XML contributors, so its parent has no unique application origin.",
        'argument-overridden': "A later XML value replaced this argument before native value generation.",
    }],
    [['argument-group'], {
        'argument-group-failed': "The native argument group read failed before returning its parsed argument map.",
        'argument-group-origin-unconfirmed': "A custom group selector, parser or XML handoff did not establish the original group consumed by the reader.",
        'argument-group-selected': covered,
    }],
    [[
        'argument', 'argument-group', 'argument-helper', 'argument-model', 'argument-name',
        'argument-path', 'argument-shared', 'argument-translate', 'argument-type',
        'argument-updater', 'configured-argument', 'configured-argument-name', 'configured-item',
        'configured-item-name', 'parameter', 'parameter-name', 'reference', 'reference-name',
        'visibility-argument', 'visibility-argument-name',
    ], {
        'argument-group-ignored': "The native block reader selects only its first arguments group. This later group and its descendants supplied no values through that read.",
    }],
    [[
        'argument-helper', 'argument-model', 'argument-path', 'argument-shared', 'argument-translate',
    ], {
        'argument-modifier-ambiguous': "Multiple original action operands match this native argument evaluation. No single original modifier field can receive evaluation credit.",
        'argument-modifier-deferred': "The native reader preserved this modifier for a later interpreter; it has not established modifier evaluation.",
        'argument-modifier-evaluated': covered,
        'argument-modifier-failed': "The native modifier consumer failed before completing its evaluation.",
        'argument-modifier-origin-unconfirmed': "The native interpreter handoff does not uniquely establish this original modifier operand.",
    }],
    [['argument-name'], {
        'argument-name-applied': covered,
        'argument-name-mixed-origin': "The value at this parser key combines original declarations. The assignment cannot choose one complete original name operand.",
        'argument-name-origin-unconfirmed': "The native value or assignment handoff does not establish this original name operand for the applied key.",
        'argument-name-overridden': "A later declaration replaced the value associated with this original parser key before its native block-data assignment.",
    }],
    [['action-argument', 'argument'], {
        'argument-origin-unconfirmed': "The argument interpreter chain includes an unverified implementation or intercepted method. Original-source value ownership is unavailable for this argument tree.",
    }],
    [['argument-type'], {
        'argument-type-ambiguous': "Multiple original action operands match this native argument evaluation. No single original type field can receive evaluation credit.",
        'argument-type-deferred': "The native reader selected its pass-through interpreter for this original type. Concrete value interpretation is deferred; selection alone earns zero evaluation hits.",
        'argument-type-evaluated': covered,
        'argument-type-failed': "Native interpretation selected this type but failed before completing evaluation.",
        'argument-type-origin-unconfirmed': "The type dispatch used an unverified selector or native input handoff. No original type evaluation is credited.",
    }],
    [['configured-argument'], {
        'configured-argument-evaluated': covered,
    }],
    [['configured-argument', 'configured-argument-name'], {
        'configured-argument-supplied': covered,
        'configured-class-selected': covered,
    }],
    [['configured-item'], {
        'configured-item-evaluated': covered,
    }],
    [['configured-item-name'], {
        'configured-item-name-applied': covered,
    }],
    [['configured-argument', 'configured-argument-name', 'configured-item', 'configured-item-name'], {
        'configured-operand-origin-unconfirmed': "The native configured object argument or constructor handoff has no uniquely verified source.",
    }],
    [['parameter'], {
        'parameter-evaluated': covered,
        'parameter-value-inherited': "This empty overlay supplied the name while Magento retained the earlier parameter value.",
    }],
    [['parameter-name'], {
        'parameter-name-applied': covered,
    }],
    [['parameter', 'parameter-name'], {
        'parameter-origin-unconfirmed': "The native parameter input or evaluator has no uniquely verified original source.",
        'parameter-overridden': "A later parameter replaced this operand in Magento’s named parameter map.",
    }],
    [['argument-updater'], {
        'updater-ambiguous': "Multiple argument origins supplied identical updater metadata at the native interpreter boundary.",
        'updater-executed': covered,
        'updater-failed': "The native updater call failed before returning a value.",
        'updater-ignored': "The native argument parser omitted this updater from the argument metadata.",
    }],
];
