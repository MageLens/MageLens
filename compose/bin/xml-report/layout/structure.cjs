// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {covered, observed} = require('./outcomes.cjs');

module.exports = [
    [[
        'container-display', 'container-htmlClass', 'container-htmlId', 'container-htmlTag',
        'container-label', 'reference', 'reference-name',
    ], {
        'container-attribute-overridden': "A later container declaration supplied the attribute used during generation.",
    }],
    [[
        'block-display', 'container-display', 'container-htmlClass', 'container-htmlId',
        'container-htmlTag', 'container-label', 'reference', 'reference-name',
    ], {
        'container-attribute-replaced': "A runtime structure assignment replaced this XML attribute before its native rendering boundary.",
    }],
    [['container'], {
        'container-created': covered,
    }],
    [['container-label', 'reference', 'reference-name'], {
        'container-label-applied': covered,
        'container-label-read': covered,
    }],
    [[
        'container-htmlClass', 'container-htmlId', 'container-htmlTag', 'reference',
        'reference-name',
    ], {
        'container-wrapper-rendered': covered,
    }],
    [['container-htmlClass', 'reference', 'reference-name'], {
        'container-wrapper-zero-class-emitted': covered,
    }],
    [['move-as'], {
        'move-alias-applied': covered,
        'move-alias-unchanged': "The native move retained the existing child alias.",
    }],
    [['move', 'move-destination', 'move-element'], {
        'move-applied': covered,
        'move-unchanged': "The native move left the parent, alias and sibling order unchanged.",
    }],
    [['move-after', 'move-as', 'move-before', 'move-destination'], {
        'move-destination-missing': "The requested destination was absent. The native move could detach its existing source but could not apply this destination, alias or order.",
    }],
    [['move', 'move-element'], {
        'move-detached': covered,
    }],
    [['move-after', 'move-before'], {
        'move-ignored': "The native move reader selected after and ignored this before attribute.",
        'move-order-applied': covered,
        'move-order-unchanged': "The native destination reorder left its child order unchanged.",
    }],
    [[
        'move', 'move-after', 'move-as', 'move-before', 'move-destination', 'move-element',
    ], {
        'move-origin-unconfirmed': "The native move schedule or structure uses customized storage or accessors without a verified original-source handoff.",
        'move-overridden': "A later XML move replaced this scheduled move before execution.",
        'move-replaced': "A later programmatic schedule write replaced this move, including an equal-valued tuple.",
        'move-target-missing': "The scheduled move had no target in the structure Magento built.",
        'move-unresolved': "The scheduled move did not establish the requested parent.",
    }],
    [['move'], {
        'move-removed': covered,
    }],
    [['position-as'], {
        'position-alias-applied': covered,
    }],
    [['position-after', 'position-before'], {
        'position-ignored': "The native scheduling helper selected after and ignored this before attribute.",
        'position-order-applied': covered,
        'position-order-unchanged': "The native ordering operation left the child order unchanged.",
    }],
    [['position-name'], {
        'position-name-applied': covered,
        'position-name-defaulted': "Native scheduling ignores the empty or zero name and generates an anonymous identifier. The original name operand did not assign that identifier; the declaration retains independent creation and rendering evidence.",
    }],
    [['position-after', 'position-as', 'position-before', 'position-name'], {
        'position-replaced': "A later native structure operation replaced this declaration identity, alias or sibling order.",
    }],
    [['reference', 'reference-name'], {
        'reference-child-attached': covered,
        'reference-child-replaced': "A later native schedule or parenting write replaced this original child-parent assignment, including equal-valued writes.",
        'reference-origin-unconfirmed': "The reference reader, XML name accessor or structural storage lacks a verified native handoff. Independent descendant facts remain separate.",
        'reference-target-missing': "The named reference target was absent at the observed native structural-build boundary.",
        'reference-target-observed': observed,
        'reference-target-removed': "The named reference target was removed at the observed native structural-build boundary.",
        'reference-unchanged': "This empty reference matched a native structural target and supplied no operation.",
    }],
    [['reference', 'reference-name', 'removal'], {
        'removal-applied': covered,
        'removal-canceled': "Magento canceled this scheduled removal before generating the structure.",
        'removal-empty-ignored': "The native reference reader treats the empty or zero remove spelling as false in both its removal and cancellation branches. It leaves any earlier removal queued.",
        'removal-restored': covered,
    }],
];
