// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createJavascriptScope} = require('../bin/javascript-scope.cjs');

test('duplicate build selection retains unloaded application features and records reasons', () => {
    const files = ['app/code/A/unvisited.js', 'vendor/a/b/library.js', 'vendor/a/b/library.min.js', 'vendor/a/b/view/frontend/tailwind/config.js'];
    const scope = createJavascriptScope(files.map(file => `src/${file}`), {libraries: [files[2]], exclude: [{path: files[1], replacement: files[2], reason: 'Templates load the minified build.'}], requiredExecuted: [files[2]]});
    assert.deepEqual(scope.included.map(entry => [entry.path, entry.group]), [[files[0], 'application'], [files[2], 'libraries']]);
    assert.equal(scope.excluded.length, 2);
    assert.equal(scope.metric, 'statements');
    assert.equal(scope.inline, undefined);
    assert.ok(scope.included.every(entry => entry.path.endsWith('.js')));
});

test('scope mistakes fail explicitly instead of silently changing the denominator', () => {
    const files = ['src/app/code/A/example.js'];
    for (const config of [{libraries: ['missing.js']}, {requiredExecuted: ['missing.js']},
        {exclude: [{path: 'app/code/A/example.js'}]},
        {exclude: [{path: 'app/code/A/example.js', replacement: 'missing.js', reason: 'duplicate'}]},
        {metric: 'lines'}, {inline: 'false'}]) assert.throws(() => createJavascriptScope(files, config));
});
