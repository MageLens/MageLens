// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Explicit public allowlist, shared by serving, revision checks and self-coverage.
const modules = [
    'dom.mjs',
    'state.mjs',
    'stream.mjs',
    'layout.mjs',
    'graph.mjs',
    'graph-node.mjs',
    'details.mjs',
    'test-progress.mjs',
    'pulse.mjs',
    'run-history.mjs',
    'run-summary.mjs'
];
const assets = {
    '/': ['index.html', 'text/html'],
    '/app.js': ['app.js', 'text/javascript'],
    '/model.js': ['model.cjs', 'text/javascript'],
    '/style.css': ['style.css', 'text/css'],
    ...Object.fromEntries(modules.map((file) => ['/' + file, [file, 'text/javascript']]))
};
module.exports = {assets};
