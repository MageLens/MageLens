// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {covered} = require('./outcomes.cjs');

module.exports = [
    [[
        'asset-attribute-as', 'asset-attribute-async', 'asset-attribute-charset',
        'asset-attribute-crossorigin', 'asset-attribute-defer', 'asset-attribute-hreflang',
        'asset-attribute-integrity', 'asset-attribute-media', 'asset-attribute-rel',
        'asset-attribute-rev', 'asset-attribute-sizes', 'asset-attribute-target',
        'asset-attribute-type',
    ], {
        'asset-attribute-emitted': covered,
        'asset-attributes-discarded': "The native font renderer supplied its fixed preload attributes and discarded these XML attributes.",
    }],
    [['asset-condition'], {
        'asset-condition-rendered': covered,
    }],
    [[
        'asset-attribute-as', 'asset-attribute-async', 'asset-attribute-charset',
        'asset-attribute-crossorigin', 'asset-attribute-defer', 'asset-attribute-hreflang',
        'asset-attribute-integrity', 'asset-attribute-media', 'asset-attribute-rel',
        'asset-attribute-rev', 'asset-attribute-sizes', 'asset-attribute-target',
        'asset-attribute-type', 'asset-condition', 'asset-order', 'asset-reference',
        'asset-src', 'asset-src-type',
    ], {
        'asset-controller-origin-unconfirmed': "The native controller asset handoff did not establish the original route-to-URL conversion.",
        'asset-emission-unconfirmed': "The renderer did not verify that the native asset URL contributed to the returned tag.",
        'asset-overridden': "A later declaration replaced this scheduled resource before native asset output.",
        'asset-removed-before-output': "The native removal pass removed this scheduled resource before asset generation.",
        'asset-replaced': "A runtime assignment replaced this scheduled XML resource before native asset output.",
        'asset-storage-unconfirmed': "The native asset collection storage or asset getter result could not be attributed to this XML declaration.",
    }],
    [['asset-src', 'asset-src-type'], {
        'asset-controller-url-generated': covered,
    }],
    [['asset-order'], {
        'asset-group-applied': covered,
    }],
    [['asset-reference', 'asset-src', 'asset-src-type'], {
        'asset-reference-rendered': covered,
    }],
    [['asset-removal', 'asset-removal-node'], {
        'asset-removal-target-missing': "The scheduled removal had no asset in the native page configuration.",
        'asset-removed': covered,
    }],
];
