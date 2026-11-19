// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {defineConfig} = require('cypress');
const {specPatterns} = require('./bin/project.cjs');
module.exports = defineConfig({
    video: false,
    modifyObstructiveCode: false,
    experimentalCspAllowList: ['default-src', 'script-src', 'script-src-elem'],
    viewportWidth: 1100,
    viewportHeight: 900,
    defaultCommandTimeout: 15000,
    requestTimeout: 15000,
    expose: {hyvaCsp: process.env.MAGELENS_THEME === 'hyva', coverageRun: process.env.COVERAGE_RUN, codeCoverage: {expectFrontendCoverageOnly: true}},
    e2e: {
        baseUrl: process.env.CYPRESS_BASE_URL || 'https://magelens.test',
        specPattern: specPatterns(),
        supportFile: 'cypress/support/e2e.js',
        setupNodeEvents(on, config) {
            if (config.expose.warmup) {
                const fs = require('node:fs');
                on('task', {
                    'warmup:diagnostics'(diagnostics) {
                        fs.writeFileSync('coverage/warmup-diagnostics.json', JSON.stringify(diagnostics, null, 2));
                        if (diagnostics.failed) console.error('Warm-up diagnostics:', JSON.stringify(diagnostics, null, 2));
                        return null;
                    }
                });
            } else {
                require('@cypress/code-coverage/task')(on, config);
                const {captureHtml} = require('./bin/html-validation.cjs');
                const {startAttempt, finishAttempt, recordJavascript} = require('./bin/test-attempts.cjs');
                on('task', {mageLensAttempt: ({event, ...attempt}) => event === 'start'
                    ? startAttempt({runner: 'cypress', ...attempt}) : finishAttempt(attempt),
                mageLensAttemptJavascript: recordJavascript});
                // A capture problem must not fail the test that requested the audit.
                on('task', {mageLensValidateHtml(capture) {
                    try { captureHtml({runner: 'cypress', ...capture}); }
                    catch (error) { console.error('HTML validation capture failed:', error.message); }
                    return null;
                }});
            }
            return config;
        }
    }
});
