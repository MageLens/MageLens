// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {sourceFiles} = require('./branching-rust-coverage.cjs');

test('Rust self-coverage includes nested estimator modules and embedded cost configuration', () => {
    const files = sourceFiles(path.resolve(__dirname, '../branching/planner'));
    for (const file of ['src/assessment/runtime.rs', 'src/assessment/collection.rs',
        'src/project/dependencies.rs', 'src/project/effects.rs', 'src/baseline.json', 'src/limits.json'])
        assert.ok(files.includes(file), `Missing source: ${file}`);
    assert.equal(new Set(files).size, files.length);
    assert.ok(files.every(file => file.startsWith('src/') && /\.(rs|json)$/.test(file)));
});
