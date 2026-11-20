// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const {test, magento, magerun} = require('../../../../../../../cli/support.cjs');

const probe = (action, value) => magento(['magelens:probe', action, value]);

test('preserves command arguments and runs a named cron job through MageRun', async () => {
    const value = "a space, a quote ' and a dollar $";
    assert.equal((await probe('echo', value)).stdout.trim(), value);
    const result = await magento(['magelens:probe', 'invalid', value], {expectedExitCode: 2});
    assert.match(result.stderr, /Unknown probe action/);
    assert.equal((await probe('fork', value)).stdout.trim(), value);
    const job = 'magelens_magerun_probe';
    try {
        assert.deepEqual(JSON.parse((await probe('magerun-messages', job)).stdout), []);
        await probe('cold-cron-config', job);
        const native = await magerun(['sys:cron:run', job]);
        assert.match(native.stdout, /runNamed.*done/s);
        assert.deepEqual(JSON.parse((await probe('magerun-messages', job)).stdout), ['magerun-handler-ran']);
    } finally {
        await probe('clean-magerun', job);
    }
});

test('executes a scheduled Magento cron job', async () => {
    const schedules = new Map();
    try {
        for (const [job, expectedStatus] of [['magelens_probe', 'success'], ['magelens_failing_probe', 'error']]) {
            const schedule = (await probe('schedule', job)).stdout.trim();
            assert.match(schedule, /^\d+$/);
            schedules.set(schedule, expectedStatus);
            assert.equal((await probe('status', schedule)).stdout.trim(), 'pending');
        }
        await probe('cold-cron-config', 'magelens_probe');
        await magento(['cron:run', '--group=magelens_probe']);
        for (const [schedule, expectedStatus] of schedules) {
            assert.equal((await probe('status', schedule)).stdout.trim(), expectedStatus);
        }

        const warm = (await probe('schedule', 'magelens_probe')).stdout.trim();
        assert.match(warm, /^\d+$/);
        schedules.set(warm, 'success');
        await magento(['cron:run', '--group=magelens_probe']);
        assert.equal((await probe('status', warm)).stdout.trim(), 'success');

        await probe('clean-generated', '0');
        assert.deepEqual(JSON.parse((await probe('generated-schedules', '0')).stdout), []);
        await probe('cold-cron-config', 'magelens_generated_probe');
        await magento(['cron:run', '--group=magelens_generated_probe']);
        const generated = JSON.parse((await probe('generated-schedules', '0')).stdout);
        assert.ok(generated.includes('pending'), 'The native scheduler must persist a future due row');
        assert.ok(generated.every(status => status === 'pending' || status === 'success'));

        // At a minute boundary, the observer's dispatch clock may precede the
        // generator's clock. Prove callback entry with an explicitly due row.
        const generatedDue = (await probe('schedule', 'magelens_generated_probe')).stdout.trim();
        assert.match(generatedDue, /^\d+$/);
        assert.equal((await probe('status', generatedDue)).stdout.trim(), 'pending');
        await probe('cold-cron-config', 'magelens_generated_probe');
        await magento(['cron:run', '--group=magelens_generated_probe']);
        assert.equal((await probe('status', generatedDue)).stdout.trim(), 'success');
    } finally {
        for (const id of schedules.keys()) await probe('unschedule', id);
        await probe('clean-generated', '0');
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
