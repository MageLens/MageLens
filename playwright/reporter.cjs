// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
class CoverageReporter {
    onBegin(config, suite) {
        this.tests = suite.allTests();
        if (process.env.MAGELENS_NATIVE_PROFILE && process.env.MAGELENS_NATIVE_PREPARE === undefined) {
            this.predictor = new (require('../branching/runners/playwright/native-reporter.cjs'))();
            this.predictor.onBegin(config, suite);
        }
    }
    onTestEnd(test, result) { this.predictor?.onTestEnd(test, result); }
    onError(error) { this.predictor?.onError(error); }
    onEnd(result) {
        this.predictor?.onEnd(result);
        // The branching driver validates and writes one result for the complete suite.
        if (process.env.MAGELENS_NATIVE_REPORT) return;
        const tests = this.tests || [];
        const count = status => tests.filter(test => test.results.at(-1)?.status === status).length;
        const run = JSON.parse(fs.readFileSync('coverage/run.json'));
        const browsers = tests.map(test => test.annotations?.find(annotation => annotation.type === 'magelens-browser')?.description);
        const browser = browsers.length && browsers.every(value => value && value === browsers[0]) ? JSON.parse(browsers[0]) : null;
        fs.writeFileSync('coverage/playwright-results.json', JSON.stringify({
            run: run.id, runner: 'playwright', status: result.status, browser,
            totalTests: tests.length, totalPassed: count('passed'), totalFailed: count('failed') + count('timedOut') + count('interrupted'),
            totalPending: tests.filter(test => !test.results.length).length,
            totalSkipped: count('skipped'),
            maxAttempts: Math.max(0, ...tests.map(test => test.results.length)),
            specs: [...new Set(tests.map(test => test.location.file))].sort(),
            tests: tests.map(test => ({title: test.title, status: test.results.at(-1)?.status || 'pending'}))
        }, null, 2));
    }
}
module.exports = CoverageReporter;
