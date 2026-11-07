// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const {foreignTransactions} = require('./fixtures/branching-restarts/transactions.cjs');

test('checkpoint fence permits only the owned inactive-schema import', () => {
    const ownedImport = {schema: 'run_b', user: 'root', host: 'localhost'};
    const unexpected = [
        {...ownedImport, schema: 'run_a'},
        {...ownedImport, schema: 'unrelated'},
        {...ownedImport, user: 'magento'},
        {...ownedImport, host: 'remote-host'},
        {schema: null, user: null, host: null}
    ];
    const ownership = {activeSchema: 'run_a', target: 'run_b', ownedSchemas: ['run_a', 'run_b']};
    assert.deepEqual(foreignTransactions([ownedImport, ...unexpected], ownership), unexpected);
    for (const invalid of [
        {...ownership, target: undefined},
        {...ownership, activeSchema: 'run_b'},
        {...ownership, ownedSchemas: ['run_a']}
    ]) assert.deepEqual(foreignTransactions([ownedImport], invalid), [ownedImport]);
});
