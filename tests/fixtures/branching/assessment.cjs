// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

function assessed(manifest) {
    for (const test of manifest.tests) test.scope ??= test.id;
    manifest.implementation = 'rust-prefix-v3';
    manifest.assessment = {version:'measured-first-use-v1', status:'complete',
        analysis:{status:'complete',collectionComplete:true,collectionDiagnostics:0}};
    return manifest;
}
module.exports = {assessed};
