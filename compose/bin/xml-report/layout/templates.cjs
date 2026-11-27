// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {covered, observed} = require('./outcomes.cjs');

module.exports = [
    [['action-argument'], {
        'template-assignment-origin-unconfirmed': "The action call did not establish a unique native template assignment from this original argument. Custom setters, plugins, storage and ambiguous calls retain no template execution credit.",
    }],
    [[
        'action-argument', 'argument', 'reference', 'reference-name', 'template',
    ], {
        'template-cache-unconfirmed': "Cached block HTML bypassed this selected template. Cached bytes do not establish fresh original XML template execution.",
        'template-context-storage-unconfirmed': "The template context backing property has hooks, unset storage, pending lazy initialization or no verified object. The native engine context cannot be matched without invoking application code.",
        'template-engine-pool-storage-unconfirmed': "The template engine pool backing property has hooks, unset storage, pending lazy initialization or no verified object. Its selection handoff cannot be inspected without invoking application code.",
        'template-executed': covered,
        'template-failed': "The native template fetch boundary failed. Any independently completed engine execution remains a separate fact.",
        'template-field-access-unconfirmed': "Template storage is opaque or publicly writable/promoted, or a custom block implementation or scoped closure can access it outside the observed native accessors. Those accesses are not traced; an equal filename cannot establish original XML execution ownership.",
        'template-origin-unconfirmed': "The rendering input passed through an unverified template getter, filename resolver or PHP template engine handoff, or template validation supplied no attributable native decision. Native XML selection cannot establish original template execution ownership. Hooked or magic property storage can replace the selection even when values match.",
        'template-overridden': "A later declaration supplied the template used during block generation",
        'template-replaced': "A later PHP template assignment replaced this XML selection before template execution.",
        'template-resolver-storage-unconfirmed': "The template resolver backing property has hooks, unset storage, pending lazy initialization or no verified object. Reading it for attribution could execute application code; original template execution remains unconfirmed.",
        'template-selected': observed,
        'template-validation-rejected': "The native template file validator rejected the effective file at the original template fetch boundary. No PHP template execution occurred on this path.",
    }],
    [['argument', 'reference', 'reference-name'], {
        'template-constructor-origin-unconfirmed': "The native constructor data, value getter or template setter did not establish this original argument as the template selection. Argument application and reads remain independent.",
    }],
    [['reference', 'reference-name', 'template'], {
        'template-empty-ignored': "The native block generator treats the original empty string or zero template spelling as empty and skips its template assignment. Any PHP default template has a separate origin.",
    }],
];
