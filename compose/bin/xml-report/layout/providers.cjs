// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {allKinds, covered} = require('./outcomes.cjs');

module.exports = [
    [allKinds, {
        'file-overridden': "A selected native file-list replacement displaced this source in the effective theme.",
        'file-provider-excluded': "Magento’s native module output filter excluded this provider from the effective layout file list.",
        'origin-limit': "Runtime layout document tracking reached its 256-document bound before this declaration could receive original-source evidence.",
        'validation-failed': "Native merged-layout validation stopped construction before this instruction could execute.",
        'xml-ownership-revoked': "Mutable layout XML reached external PHP or an unverified reader or parser, or was reassigned before native interpretation, so original ownership could not be retained.",
    }],
    [['file-override'], {
        'file-override-selected': covered,
        'file-override-unconfirmed': "The override source was selected without an attributable native file-list replacement.",
    }],
    [['file-selection'], {
        'file-selected': "Magento selected this file as merged layout input. Descendant declarations require their own native effect evidence.",
    }],
    [['handle-label'], {
        'handle-label-evaluated': covered,
    }],
    [['handle-label', 'handle-type'], {
        'handle-metadata-origin-unconfirmed': "The metadata API passed through an unverified implementation or plugin. Native field evaluation and final result ownership remain separate.",
        'handle-metadata-overridden': "A later package entry with the same handle replaced this metadata in the native result map.",
        'handle-metadata-returned': "The native API returned a handle metadata snapshot. Later PHP array offsets and classification calls do not preserve per-field origin identity.",
    }],
    [['handle-type'], {
        'handle-type-evaluated': covered,
    }],
    [['include', 'include-handle'], {
        'include-cycle': "Magento was processing the included handle and skipped recursive re-entry",
        'include-duplicate': "Magento had already processed the included handle",
        'include-missing': "Magento found no package or database layout update for the handle",
        'include-traversed': covered,
    }],
    [['wireframe-selection'], {
        'wireframe-origin-unconfirmed': "The page-layout getter or active plugin lacks a verified original-source handoff. An equal result alone cannot establish ownership; selector identities longer than 4096 bytes are also unmeasured.",
    }],
    [['wireframe', 'wireframe-selection'], {
        'wireframe-selected': covered,
    }],
];
