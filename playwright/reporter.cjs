// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
class CoverageReporter {
    onBegin(_config, suite) { this.tests = suite.allTests(); }
    onEnd(result) {
        const tests = this.tests || [];
        const count = status => tests.filter(test => test.results.at(-1)?.status === status).length;
        const run = JSON.parse(fs.readFileSync('coverage/run.json'));
        fs.writeFileSync('coverage/playwright-results.json', JSON.stringify({
            run: run.id, runner: 'playwright', status: result.status,
            totalTests: tests.length, totalPassed: count('passed'), totalFailed: count('failed') + count('timedOut') + count('interrupted'),
            totalPending: tests.filter(test => !test.results.length).length,
            totalSkipped: count('skipped'),
            specs: [...new Set(tests.map(test => test.location.file))].sort(),
            tests: tests.map(test => ({title: test.title, status: test.results.at(-1)?.status || 'pending'}))
        }, null, 2));
    }
}
module.exports = CoverageReporter;
