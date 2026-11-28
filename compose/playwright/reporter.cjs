// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
class CoverageReporter {
    onBegin(_config, suite) { this.tests = suite.allTests(); }
    onEnd(result) {
        const tests = this.tests || [];
        // Playwright's outcome honours test.fail(): an expected failure passes and an unexpected pass fails.
        // An interrupted test failed; a test without a result never ran.
        const state = test => {
            const status = test.results.at(-1)?.status;
            if (!status) return 'pending';
            if (status === 'interrupted') return 'failed';
            return {expected: 'passed', flaky: 'passed', unexpected: 'failed', skipped: 'skipped'}[test.outcome()];
        };
        const count = value => tests.filter(test => state(test) === value).length;
        const run = JSON.parse(fs.readFileSync('coverage/run.json'));
        const browsers = tests.map(test => test.annotations?.find(annotation => annotation.type === 'magelens-browser')?.description);
        const browser = browsers.length && browsers.every(value => value && value === browsers[0]) ? JSON.parse(browsers[0]) : null;
        fs.writeFileSync('coverage/playwright-results.json', JSON.stringify({
            run: run.id, runner: 'playwright', status: result.status, browser,
            totalTests: tests.length, totalPassed: count('passed'), totalFailed: count('failed'),
            totalPending: count('pending'), totalSkipped: count('skipped'),
            specs: [...new Set(tests.map(test => test.location.file))].sort(),
            tests: tests.map(test => ({title: test.title, status: state(test)}))
        }, null, 2));
    }
}
module.exports = CoverageReporter;
