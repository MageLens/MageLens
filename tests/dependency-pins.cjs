// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../dependencies.yaml'), 'utf8');
module.exports = name => {
    assert.match(name, /^[A-Z_]+$/);
    const match = source.match(new RegExp(`^${name}: "([^"]+)"`, 'm'));
    assert.ok(match, `Missing ${name} dependency pin`);
    return match[1];
};
