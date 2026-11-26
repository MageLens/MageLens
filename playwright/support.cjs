// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createCoverageMap} = require('istanbul-lib-coverage');
const {withTemplateCoverage} = require('@magelens/magento-template-coverage/playwright');
const playwright = require('@playwright/test');
const {disablePageTransitions, installPlaywrightAdminDependencies, observeAdminMenuNavigation} = require('../bin/browser-navigation.cjs');
const {captureHtml} = require('../bin/html-validation.cjs');
const {recordXmlBrowserEvidence} = require('../bin/xml-browser-evidence.cjs');
const {installUiBrowserObserver} = require('../bin/xml-ui-browser.cjs');
const {loadUiBrowserScope} = require('../bin/xml-ui-browser-scope.cjs');
const {newAttemptId, projectPath, startAttempt, finishAttempt, recordJavascript} = require('../bin/test-attempts.cjs');
const {sparseCounters} = require('../bin/javascript-attempts.cjs');
const {failureHtmlFilename, failureSnapshotDocument, failureSnapshotUnavailable} = require('../cypress/support/failure-html.cjs');
const {wrapTestType} = require('./failure-snapshot-hooks.cjs');

function playwrightSpecPath(testInfo) {
    const titlePathSpec = testInfo.titlePath?.[0];
    if (typeof titlePathSpec !== 'string' || !/\.(?:spec|cy)\.[cm]?[jt]sx?$/.test(titlePathSpec)) {
        return projectPath(testInfo.file, testInfo.config.rootDir);
    }
    const testDir = testInfo.project.testDir || testInfo.config.rootDir;
    return projectPath(path.resolve(testDir, titlePathSpec), testInfo.config.rootDir);
}

function snapshotMetadata(testInfo, pageIndex, phase, reason) {
    let runId = 'run-unknown';
    try { runId = JSON.parse(fs.readFileSync(path.resolve(testInfo.config.rootDir, 'coverage/run.json'))).id || runId; }
    catch { /* Keep the diagnostic useful when collection metadata is unavailable. */ }
    const titlePath = testInfo.titlePath;
    const spec = playwrightSpecPath(testInfo);
    return {
        runner: 'playwright', runId, spec, test: titlePath.join(' > '),
        testId: testInfo.testId, attempt: testInfo.retry + 1, worker: testInfo.workerIndex,
        parallel: testInfo.parallelIndex, page: pageIndex + 1, phase, reason,
        capturedAt: new Date().toISOString()
    };
}

function recordSnapshotNote(testInfo, message) {
    try { testInfo.annotations.push({type: 'failure-html-snapshot', description: String(message).slice(0, 500)}); }
    catch { /* Snapshot diagnostics must not replace the test result. */ }
}

function writeSnapshot(testInfo, index, metadata, html) {
    try {
        const name = failureHtmlFilename(`failure-page-${index + 1}`, {
            attempt: testInfo.retry + 1,
            runId: metadata.runId,
            workerId: `w${testInfo.workerIndex}-p${testInfo.parallelIndex}`
        });
        const output = testInfo.outputPath(name);
        fs.mkdirSync(path.dirname(output), {recursive: true});
        fs.writeFileSync(output, html, {encoding: 'utf8', flag: 'wx'});
        return true;
    } catch (error) {
        if (error.code === 'EEXIST') return true;
        recordSnapshotNote(testInfo, `Could not save the HTML snapshot (${error.code || 'write error'}).`);
        return false;
    }
}

async function saveFailureSnapshots(context, testInfo, phase, reason) {
    try {
        let openPages;
        try { openPages = context.pages(); }
        catch (error) {
            const metadata = snapshotMetadata(testInfo, 0, phase, reason);
            writeSnapshot(testInfo, 0, metadata, failureSnapshotUnavailable(metadata, error?.message || 'The browser context was unavailable.'));
            return;
        }
        const pages = openPages.slice(0, 4);
        if (openPages.length > pages.length) recordSnapshotNote(testInfo, 'Only the first four open pages were captured.');
        const targets = pages.length ? pages : [null];
        const deadline = Date.now() + 1200;
        for (const [index, page] of targets.entries()) {
            let metadata;
            try {
                metadata = snapshotMetadata(testInfo, index, phase, reason);
                let html;
                if (!page || page.isClosed()) {
                    html = failureSnapshotUnavailable(metadata, 'No accessible application page remained at capture time.');
                } else {
                    let timer;
                    try {
                        const remaining = Math.max(0, deadline - Date.now());
                        if (!remaining) throw new Error('The bounded capture window expired.');
                        html = await Promise.race([
                            page.evaluate(failureSnapshotDocument, metadata),
                            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The page did not respond to snapshot capture in time.')), remaining); })
                        ]);
                    } catch (error) {
                        html = failureSnapshotUnavailable(metadata, error?.message || 'The application page could not be captured.');
                    } finally { clearTimeout(timer); }
                }
                writeSnapshot(testInfo, index, metadata, html);
            } catch (error) {
                metadata ||= snapshotMetadata(testInfo, index, phase, reason);
                writeSnapshot(testInfo, index, metadata, failureSnapshotUnavailable(metadata, error?.message || 'Snapshot capture was unavailable.'));
            }
        }
    } catch (error) {
        recordSnapshotNote(testInfo, `Could not capture the HTML snapshot (${error?.code || 'capture error'}).`);
        try {
            const metadata = snapshotMetadata(testInfo, 0, phase, reason);
            writeSnapshot(testInfo, 0, metadata, failureSnapshotUnavailable(metadata, error?.message || 'Snapshot capture failed.'));
        } catch { /* The snapshot path must never replace the original test result. */ }
    }
}

function withCoverage(base = playwright.test) {
    return wrapTestType(withTemplateCoverage(base, {outputDir: 'coverage/raw/templates'}).extend({
        recordXmlBrowserEvidence: async ({}, use) => { await use(recordXmlBrowserEvidence); },
        browserIdentity: [async ({browser}, use, testInfo) => {
            testInfo.annotations.push({type: 'magelens-browser', description: JSON.stringify({
                name: testInfo.project.use.channel, version: browser.version()
            })});
            await use();
        }, {auto: true}],
        failureSnapshotFallback: [async ({context}, use, testInfo) => {
            try { await use(); }
            finally {
                if (testInfo.status !== testInfo.expectedStatus) {
                    await saveFailureSnapshots(context, testInfo, 'fixture-fallback', testInfo.error?.message || 'The test did not meet its expected status.');
                }
            }
        }, {auto: true}],
        applicationErrors: [async ({context}, use, testInfo) => {
            const errors = [];
            const record = error => errors.push(error.message);
            const track = page => page.on('pageerror', record);
            context.on('page', track);
            for (const page of context.pages()) track(page);
            try { await use(); }
            finally {
                if (errors.length) await saveFailureSnapshots(context, testInfo, 'application-errors', errors.join('; '));
                context.off('page', track);
                for (const page of context.pages()) page.off('pageerror', record);
                playwright.expect(errors, 'Uncaught application errors').toEqual([]);
            }
        }, {auto: true}],
        // Captures the HTML source of the page's current URL for the validation report; see docs/coverage.md#html-validation.
        mageLensValidateHtml: async ({}, use, testInfo) => {
            await use(async page => {
                // A capture problem must not fail the test that requested the audit.
                try {
                    const url = page.url();
                    const capture = {runner: 'playwright', url, spec: playwrightSpecPath(testInfo),
                        test: testInfo.titlePath.slice(1).join(' › ')};
                    try {
                        const response = await page.request.get(url, {headers: {accept: 'text/html'}, maxRedirects: 0, timeout: 60000});
                        captureHtml({...capture, status: response.status(), contentType: response.headers()['content-type'], html: await response.text()});
                    } catch (error) {
                        captureHtml({...capture, error: error.message.split('\n')[0]});
                    }
                } catch (error) {
                    console.error('HTML validation capture failed:', error.message);
                }
            });
        },
        // Each attempt, including a retry, has its own ID; see docs/coverage.md#test-attempts.
        coverageAttempt: [async ({}, use, testInfo) => {
            const id = newAttemptId();
            startAttempt({id, runner: 'playwright', spec: playwrightSpecPath(testInfo),
                test: testInfo.titlePath.slice(1), retry: testInfo.retry, project: testInfo.project.name, worker: testInfo.workerIndex});
            try { await use(id); }
            finally { finishAttempt({id, outcome: testInfo.status}); }
        }, {auto: true}],
        // Template records carry the attempt ID where the package keeps fixture metadata.
        templateCoverageOptions: async ({coverageAttempt}, use) => use({outputDir: 'coverage/raw/templates', metadata: {attempt: coverageAttempt}}),
        context: async ({context, baseURL, coverageAttempt}, use, testInfo) => {
            const checkAdminDependencies = await installPlaywrightAdminDependencies(context);
            const run = JSON.parse(fs.readFileSync('coverage/run.json'));
            await context.addInitScript(disablePageTransitions);
            await context.addInitScript(installUiBrowserObserver, loadUiBrowserScope(run.id));
            const menuBinding = '__magelensMenu' + randomUUID().replaceAll('-', '');
            await context.exposeBinding(menuBinding, (_source, evidence) => { recordXmlBrowserEvidence(evidence); });
            await context.addInitScript({content:
                    `if (window === window.top && location.origin === ${JSON.stringify(new URL(baseURL).origin)}) {
                    (${observeAdminMenuNavigation})(window, () => '${menuBinding}', window.${menuBinding});
                }`});
            const cookie = {domain: new URL(baseURL).hostname, path: '/', sameSite: 'Lax', httpOnly: true, secure: true};
            await context.addCookies([{name: 'application_coverage', value: run.id, ...cookie},
                {name: 'application_coverage_attempt', value: coverageAttempt, ...cookie}]);
            const snapshots = new Map();
            const uiCandidates = new Map();
            const binding = '__magelensJS' + randomUUID().replaceAll('-', '');
            await context.exposeBinding(binding, (_source, snapshot) => {
                snapshots.set(snapshot.id, snapshot.coverage);
                for (const entry of snapshot.ui) uiCandidates.set(JSON.stringify(entry), entry);
            });
            await context.addInitScript(({binding}) => {
                const id = crypto.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);
                const publish = () => window[binding]({id, coverage: window.__coverage__ || {},
                    ui: window.__mageLensUiEffects?.snapshot() ?? []});
                window[binding + '_flush'] = publish;
                setInterval(() => publish().catch(() => {}), 250);
                addEventListener('pagehide', () => publish().catch(() => {}));
            }, {binding});
            const flush = async page => {
                for (const frame of page.frames()) {
                    try { await frame.evaluate(key => window[key]?.(), binding + '_flush'); }
                    catch (error) { if (!/closed|detached|destroyed|navigation/i.test(error.message)) throw error; }
                }
            };
            const closeMethods = new Map();
            const track = page => {
                const close = page.close;
                closeMethods.set(page, close);
                page.close = async function (...args) { await flush(page); return close.apply(this, args); };
            };
            context.on('page', track);
            for (const page of context.pages()) track(page);
            try { await use(context); }
            finally {
                try {
                    for (const page of context.pages()) await flush(page);
                } catch (error) {
                    await saveFailureSnapshots(context, testInfo, 'fixture-teardown', error?.message || 'A browser fixture failed during cleanup.');
                    throw error;
                }
                context.off('page', track);
                for (const [page, close] of closeMethods) page.close = close;
                try {
                    for (const entry of uiCandidates.values()) recordXmlBrowserEvidence({...entry, candidate: true});
                    const coverage = createCoverageMap({});
                    for (const snapshot of snapshots.values()) coverage.merge(snapshot);
                    fs.mkdirSync('.nyc_output', {recursive: true});
                    fs.writeFileSync(`.nyc_output/playwright-${randomUUID()}.json`, JSON.stringify(coverage));
                    checkAdminDependencies();
                    recordJavascript({id: coverageAttempt, counters: sparseCounters(coverage.toJSON())});
                } catch (error) {
                    await saveFailureSnapshots(context, testInfo, 'fixture-teardown', error?.message || 'A browser fixture failed during cleanup.');
                    throw error;
                }
            }
        }
    }), saveFailureSnapshots);
}

const test = withCoverage();
module.exports = {withCoverage, test, expect: playwright.expect};
