// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {covered} = require('./outcomes.cjs');

module.exports = [
    [['body-class', 'body-class-name', 'body-class-value'], {
        'body-class-canceled': "An empty class assignment suppressed all scheduled XML body classes, including later additions.",
        'body-class-duplicate': "The native body class assignment found this sanitized class already present.",
        'body-class-rendered': covered,
        'body-class-replaced': "A runtime body class assignment replaced the XML-origin class list before output.",
        'body-classes-cleared': covered,
    }],
    [['metadata-content'], {
        'metadata-content-fallback': "Magento used a fallback getter result in place of this empty XML content.",
    }],
    [['metadata', 'metadata-content', 'metadata-name'], {
        'metadata-content-type-derived': covered,
        'metadata-content-type-input': covered,
        'metadata-empty-suppressed': "The native metadata renderer suppressed the effective empty or zero content.",
        'metadata-origin-unconfirmed': "The native metadata getter path did not establish that the output came from the original content.",
        'metadata-overridden': "A later page configuration assignment replaced this metadata entry.",
        'metadata-rendered': covered,
        'metadata-replaced': "A runtime assignment replaced this XML metadata before its native rendering boundary.",
        'metadata-template-skipped': "Magento skipped emitting a tag for this metadata key at the native template selector.",
    }],
    [['metadata', 'metadata-name'], {
        'metadata-key-emitted': covered,
    }],
    [['page-attribute', 'page-attribute-name', 'page-attribute-value'], {
        'page-attribute-overridden': "A later page configuration assignment replaced this element attribute.",
        'page-attribute-removal-target-missing': "The native removal queue found no remaining value for this element attribute.",
        'page-attribute-removed': covered,
        'page-attribute-removed-before-output': "The native removal pass discarded this scheduled attribute before it could reach the renderer.",
        'page-attribute-rendered': covered,
        'page-attribute-replaced': "A runtime assignment replaced this XML element attribute before its native rendering boundary.",
    }],
    [['page-title'], {
        'title-empty-ignored': "The native head generator skipped assigning the effective empty or zero title.",
        'title-overridden': "A later title replaced this declaration before the page configuration was applied.",
        'title-rendered': covered,
        'title-replaced': "A runtime title assignment replaced this declaration before attribution at the renderer.",
    }],
];
