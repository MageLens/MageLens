// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test'), assert = require('node:assert/strict');
const {validate} = require('../branching/redis-state.cjs');
test('cache checkpoints reject malformed bytes, duplicate keys and incompatible databases before mutation', () => {
    for (const records of [[[16,'00','01',0]],[[0,'0','01',0]],[[0,'00','',0]],[[0,'00','01',-1]],[[0,'00','01',0],[0,'00','02',0]]])
        assert.throws(()=>validate({version:1,records},16));
    assert.throws(()=>validate({version:2,records:[]},16));
    assert.deepEqual(validate({version:1,records:{}},16),{version:1,records:[]});
});
