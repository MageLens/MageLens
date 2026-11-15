// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const test = require('node:test'), assert = require('node:assert/strict');
const {RetainedMagentoBackend} = require('../branching/retained-magento.cjs');
function backend(connections, transactions = []) {
    const b = Object.create(RetainedMagentoBackend.prototype);
    Object.assign(b,{activeSchema:'a',ownedSchemas:['a','b'],database:{},diagnostics:{}});
    b.sql = query => query.includes('INNODB_TRX') ? JSON.stringify(transactions) :
        String(connections.length > 1 ? connections.shift() : connections[0]);
    return b;
}
test('database fence waits for connection teardown even without an active transaction', async () => {
    const b = backend([1,0]);
    await b.databaseIdle(1000);
    assert.equal(b.diagnostics.databaseDrainWaits.length,1);
});
test('database fence rejects persistent connections and unfinished transactions', async () => {
    await assert.rejects(backend([1]).databaseIdle(0),/Application DB connection crossed/);
    await assert.rejects(backend([0],[{schema:'a',user:'magento',host:'local'}]).databaseIdle(0),/Unfinished database transactions/);
});
test('database fence allows only the owned inactive import and no application connections', async () => {
    const b = backend([0],[{schema:'b',user:'root',host:'localhost'}]);
    b.database.job={target:'b'};
    await b.databaseIdle(0);
    assert.equal(b.diagnostics.databaseDrainWaits,undefined);
    b.sql = query => query.includes('INNODB_TRX') ? '[]' : 'invalid';
    await assert.rejects(b.databaseIdle(0),/Application DB connection crossed/);
});
