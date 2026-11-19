// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const browserTitles = [
    'creates a category and illustrated article, publishes, moderates comments, and deletes records',
    'validates Admin input, preserves form values, and rejects forged writes',
    'requires Admin authentication and the Blog ACL permission',
    'searches, filters, paginates, reads articles, and retains favorites',
    'rejects invalid filters and keeps draft, scheduled, and inactive-category posts private',
    'collects real PHP, JavaScript and template execution',
    'starts the next test with fresh state',
    'uses inherited journal settings and shows the selected Admin fields'
];
const cliTitles = [
    'preserves command arguments and runs a named cron job through MageRun',
    'executes a scheduled Magento cron job',
    'processes a message through a Magento database queue'
];

function verifyScenarios(directory) {
    const read = file => JSON.parse(fs.readFileSync(path.join(directory, file)));
    const {id, runner = 'cypress'} = read('run.json');
    for (const [file, expected] of [[runner, browserTitles], ['cli', cliTitles]]) {
        const results = read(`${file}-results.json`);
        assert.equal(results.run, id, `Stale ${file} results`);
        assert.equal(results.totalTests, expected.length);
        assert.equal(results.totalPassed, expected.length);
        assert.equal(results.totalFailed, 0);
        assert.equal(results.totalSkipped, 0);
        assert.equal(results.totalPending, 0);
        assert.deepEqual(results.tests.map(test => test.title).sort(), [...expected].sort(),
            `Every installation must run all shared ${file} scenarios`);
        assert.ok(results.tests.every(test => test.status === 'passed'));
    }
    console.log(`Verified ${browserTitles.length} browser and ${cliTitles.length} CLI acceptance scenarios (${runner}).`);
}

if (require.main === module) verifyScenarios(process.argv[2] || 'coverage');
module.exports = {browserTitles, cliTitles, verifyScenarios};
