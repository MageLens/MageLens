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
            const fs = require('node:fs');
            const path = require('node:path');
            const screenshotsRoot = path.resolve(config.screenshotsFolder || 'cypress/screenshots');

            on('task', {
                'failureSnapshot:write'({relativePath, html}) {
                    if (
                        typeof relativePath !== 'string'
                        || !relativePath.endsWith('.html')
                        || typeof html !== 'string'
                        || Buffer.byteLength(html) > 1024 * 1024
                    ) {
                        return {saved: false, reason: 'invalid-or-oversized-snapshot'};
                    }

                    const target = path.resolve(screenshotsRoot, relativePath);
                    if (!target.startsWith(screenshotsRoot + path.sep)) {
                        return {saved: false, reason: 'invalid-path'};
                    }

                    try {
                        fs.mkdirSync(path.dirname(target), {recursive: true});
                    } catch (error) {
                        return {saved: false, reason: error.code || 'directory-error'};
                    }

                    for (let attempt = 0; attempt < 32; attempt++) {
                        const candidate = attempt
                            ? target.replace(/\.html$/, `--${attempt + 1}.html`)
                            : target;

                        try {
                            fs.writeFileSync(candidate, html, {encoding: 'utf8', flag: 'wx'});
                            return {saved: true, path: path.relative(process.cwd(), candidate)};
                        } catch (error) {
                            if (error.code === 'EEXIST') continue;
                            return {saved: false, reason: error.code || 'write-error'};
                        }
                    }

                    return {saved: false, reason: 'snapshot-name-collision'};
                }
            });

            if (config.expose.warmup) {
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
                const {recordXmlBrowserEvidence} = require('./bin/xml-browser-evidence.cjs');
                const {loadUiBrowserScope} = require('./bin/xml-ui-browser-scope.cjs');
                config.expose.xmlUiScope = loadUiBrowserScope(config.expose.coverageRun);
                on('task', {
                    mageLensAttempt: ({event, ...attempt}) => event === 'start'
                        ? startAttempt({runner: 'cypress', ...attempt}) : finishAttempt(attempt),
                    mageLensAttemptJavascript: recordJavascript,
                    recordXmlBrowserEvidence,
                    recordAdminMenuNavigation(observations) {
                        observations.forEach(recordXmlBrowserEvidence);
                        return null;
                    },
                    recordXmlUiCandidates(entries) {
                        for (const entry of entries) recordXmlBrowserEvidence({...entry, candidate: true});
                        return null;
                    }
                });
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