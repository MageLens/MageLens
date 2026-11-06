// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {checkSize} = require('./ci/artifact-size.cjs');
test('artifact size is bounded across nested files and never follows symlinks', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-artifact-size-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    fs.mkdirSync(path.join(directory, 'nested'));
    fs.writeFileSync(path.join(directory, 'first'), '12345');
    fs.writeFileSync(path.join(directory, 'nested/second'), '67890');
    assert.equal(checkSize(directory, 10), 10);
    assert.throws(() => checkSize(directory, 9), /upload blocked/);
    fs.symlinkSync(path.join(directory, 'first'), path.join(directory, 'linked'));
    assert.throws(() => checkSize(directory), /regular files/);
});
