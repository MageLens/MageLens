// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const {test, magento, magerun} = require('../../../../../../../cli/support.cjs');

const probe = (action, value) => magento(['magelens:probe', action, value]);

test('preserves command arguments and reports an expected nonzero exit', async () => {
    const value = "a space, a quote ' and a dollar $";
    assert.equal((await probe('echo', value)).stdout.trim(), value);
    const result = await magento(['magelens:probe', 'invalid', value], {expectedExitCode: 2});
    assert.match(result.stderr, /Unknown probe action/);
    assert.match((await magerun(['--skip-core-commands', '--version'])).stdout, /n98-magerun2/i);
    assert.equal((await probe('fork', value)).stdout.trim(), value);
    const database = await magerun(['db:query', 'SELECT 42 AS result']);
    assert.deepEqual(database.stdout.trim().split(/\r?\n/), ['result', '42']);
});

test('executes a scheduled Magento cron job', async () => {
    const {stdout} = await probe('schedule', '0');
    const schedule = stdout.trim();
    assert.match(schedule, /^\d+$/);
    try {
        assert.equal((await probe('status', schedule)).stdout.trim(), 'pending');
        await magento(['cron:run', '--group=magelens_probe']);
        assert.equal((await probe('status', schedule)).stdout.trim(), 'success');
    } finally {
        await probe('unschedule', schedule);
    }
});

test('processes a message through a Magento database queue', async () => {
    const token = randomBytes(12).toString('hex');
    try {
        assert.equal((await probe('received', token)).stdout.trim(), 'pending');
        await probe('publish', token);
        await magento(['queue:consumers:start', 'magelens.probe', '--max-messages=1', '--single-thread']);
        assert.equal((await probe('received', token)).stdout.trim(), token);
    } finally {
        await probe('clean', token);
    }
});
