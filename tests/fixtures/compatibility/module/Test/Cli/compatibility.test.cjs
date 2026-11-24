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
    for (const [job, method, message] of [
        ['magelens_magerun_probe', 'runNamed', 'magerun-handler-ran'],
        ['456', 'Execute', 'preferred-worker-intercepted'],
        ['magelens_cron_skipped', 'runIntercepted', '0'],
        ['magelens_cron_proceeded', 'runIntercepted', '1'],
    ]) {
        try {
            assert.deepEqual(JSON.parse((await probe('magerun-messages', job)).stdout), []);
            await probe('cold-cron-config', job);
            const native = await magerun(['sys:cron:run', job]);
            assert.match(native.stdout, new RegExp(method + '.*done', 's'));
            assert.deepEqual(JSON.parse((await probe('magerun-messages', job)).stdout), [message]);
            if (job.startsWith('magelens_cron_')) {
                assert.deepEqual(JSON.parse((await probe('generated-schedules', job)).stdout), ['success']);
            }
        } finally {
            await probe('clean-magerun', job);
        }
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
            if (expectedStatus === 'error') {
                assert.equal((await probe('messages', schedule)).stdout.trim(), 'Cron probe failed after 2 ordinary calls');
            }
        }

        const intercepted = new Map();
        for (const [job, calls] of [['magelens_cron_skipped', '0'], ['magelens_cron_proceeded', '1']]) {
            const schedule = (await probe('schedule', job)).stdout.trim();
            assert.match(schedule, /^\d+$/);
            schedules.set(schedule, 'success');
            intercepted.set(schedule, calls);
        }
        await probe('cold-cron-config', 'magelens_interceptor_probe');
        await magento(['cron:run', '--group=magelens_interceptor_probe']);
        for (const [schedule, calls] of intercepted) {
            assert.equal((await probe('status', schedule)).stdout.trim(), 'success');
            assert.equal((await probe('messages', schedule)).stdout.trim(), calls, 'Unexpected original handler call count');
        }

        const warm = (await probe('schedule', 'magelens_probe')).stdout.trim();
        assert.match(warm, /^\d+$/);
        schedules.set(warm, 'success');
        await magento(['cron:run', '--group=magelens_probe']);
        assert.equal((await probe('status', warm)).stdout.trim(), 'success');

        const generatedJob = 'magelens_generated_probe';
        await probe('clean-generated', generatedJob);
        assert.deepEqual(JSON.parse((await probe('generated-schedules', generatedJob)).stdout), []);
        await probe('cold-cron-config', generatedJob);
        await magento(['cron:run', '--group=' + generatedJob]);
        const generated = JSON.parse((await probe('generated-schedules', generatedJob)).stdout);
        assert.ok(generated.includes('pending'), 'The native scheduler must persist a future due row');
        assert.ok(generated.every(status => status === 'pending' || status === 'success'));

        // Magento runs one pending row per job each pass. Clear the rows just
        // verified, retaining the generation timestamp for the dispatch pass.
        await probe('delete-generated', generatedJob);
        const generatedDue = (await probe('schedule', generatedJob)).stdout.trim();
        assert.match(generatedDue, /^\d+$/);
        assert.equal((await probe('status', generatedDue)).stdout.trim(), 'pending');
        await probe('cold-cron-config', generatedJob);
        await magento(['cron:run', '--group=' + generatedJob]);
        assert.equal((await probe('status', generatedDue)).stdout.trim(), 'success');

        await probe('clean-generated', '123');
        const numericJobs = new Map([
            ['123', 'preferred-worker-intercepted'],
            ['0123', 'virtual-worker'],
            ['magelens_scoped_probe', 'preferred-worker-intercepted'],
        ]);
        // The native --group filter compares strings strictly, but the XML group
        // key is an integer. Exclude the other groups through the native CLI.
        const otherGroups = JSON.parse((await probe('other-cron-groups', '123')).stdout);
        const numericCron = ['cron:run', ...otherGroups.map(group => '--exclude-group=' + group)];
        for (const job of numericJobs.keys()) assert.deepEqual(JSON.parse((await probe('generated-schedules', job)).stdout), []);
        await probe('cold-cron-config', '123');
        await magento(numericCron);
        for (const job of numericJobs.keys()) {
            assert.ok(JSON.parse((await probe('generated-schedules', job)).stdout).includes('pending'), 'Missing future row for ' + job);
        }
        await probe('delete-generated', '123');
        const due = new Map();
        for (const [job, message] of numericJobs) {
            const schedule = (await probe('schedule', job)).stdout.trim();
            assert.match(schedule, /^\d+$/);
            assert.equal((await probe('status', schedule)).stdout.trim(), 'pending');
            due.set(schedule, {job, message});
        }
        // Run native history cleanup with the due rows present, as on a slow browser run.
        await probe('expire-cron-cleanup', '123');
        await probe('cold-cron-config', '123');
        await magento(numericCron);
        for (const [schedule, {job, message}] of due) {
            assert.equal((await probe('status', schedule)).stdout.trim(), 'success', 'Native dispatch did not run ' + job);
            assert.equal((await probe('messages', schedule)).stdout.trim(), message);
        }
    } finally {
        for (const id of schedules.keys()) await probe('unschedule', id);
        await probe('clean-generated', 'magelens_generated_probe');
        await probe('clean-generated', '123');
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
