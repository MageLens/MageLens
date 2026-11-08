// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.implementation, 'rust-prefix-v2');
assert.equal(manifest.tests.length, 2);
assert.equal(manifest.diagnostics.length, 0);
assert.deepEqual(manifest.tests.map(test => test.title).sort(), ['first continuation', 'second continuation']);
assert.ok(manifest.checkpoints.some(checkpoint => checkpoint.automatic && checkpoint.consumers.length === 2));
assert.deepEqual([...manifest.schedule].sort(), manifest.tests.map(test => test.id).sort());
console.log('Rust image planned both continuations and their shared prefix.');

assert.equal(manifest.assessment.version, 'js-ts-points-v3');
assert.ok(manifest.tests.every(test => test.steps.every(step => step.estimate)));

assert.equal(manifest.assessment.boundsVersion, 1);
