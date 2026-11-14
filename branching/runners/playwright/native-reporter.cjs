// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {digest} = require('../../identity.cjs');
function browserProfile(use = {}) {
    const {browserName = 'chromium', channel = null, headless = true, baseURL = null,
        ignoreHTTPSErrors = false, viewport = {width: 1280, height: 720}, serviceWorkers = 'allow'} = use;
    const supported = new Set(['browserName', 'channel', 'headless', 'baseURL', 'ignoreHTTPSErrors', 'viewport',
        'serviceWorkers', 'trace', 'screenshot', 'video']);
    return {digest: digest({browserName, channel, headless, baseURL, ignoreHTTPSErrors, viewport, serviceWorkers}),
        portable: Object.keys(use).every(key => supported.has(key)) && browserName === 'chromium' && channel === 'chrome' && headless};
}
class NativeReporter {
    constructor() { this.results = new Map(); this.errors = []; }
    onBegin(config, suite) {
        this.config = {rootDir: config.rootDir, globalSetup: !!config.globalSetup, globalTeardown: !!config.globalTeardown, webServer: !!config.webServer,
            projects: config.projects.map(p => ({name: p.name, dependencies: p.dependencies, teardown: p.teardown,
                browserProfile: browserProfile(p.use)}))};
        this.tests = suite.allTests().map(test => {
            const project = test.parent.project();
            return {id: test.id, project: project.name, file: test.location.file, line: test.location.line,
                column: test.location.column, title: test.titlePath().slice(3).join(' › '),
                selector: `[${project.name}] › ${path.relative(config.rootDir, test.location.file).replaceAll(path.sep, '/')} › ${test.titlePath().slice(3).join(' › ')}`,
                expectedStatus: test.expectedStatus, annotations: test.annotations};
        });
        if(process.env.MAGELENS_NATIVE_PROFILE) this.profile=JSON.parse(process.env.MAGELENS_NATIVE_PROFILE);
        if(this.profile && process.env.MAGELENS_NATIVE_PREPARE !== '0') {
            fs.mkdirSync(this.profile.directory,{recursive:true});
            const timing=require('../../predictor/native.cjs');
            const lifecycle=require('../../predictor/playwright.cjs');
            const loaded=new Map(suite.allTests().filter(test=>test.expectedStatus!=='skipped').map(test=>[test.id,lifecycle.describe(test)]));
            const collect=timing.collector(this.profile,this.profile.directory,config.rootDir);
            for(const file of new Set(this.tests.map(test=>test.file)))collect({file,hooks:[],lifecycle:'playwright-loaded-fixtures/v1',
                files:this.tests.filter(test=>test.file===file).flatMap(test=>loaded.get(test.id)?.files ?? []),
                tests:this.tests.filter(test=>test.file===file).map(test=>({...test,titlePath:[],
                    ...(loaded.get(test.id) ?? {timingSource:''})}))});
        }
    }
    onTestEnd(test, result) {
        const previous = this.results.get(test.id);
        this.results.set(test.id, {id: test.id, status: result.status, expectedStatus: test.expectedStatus,
            durationMs: (previous?.durationMs ?? 0) + result.duration, attempts: (previous?.attempts ?? 0) + 1,
            errors: result.errors.map(error => ({message: error.message, stack: error.stack})), annotations: test.annotations});
        if (process.env.MAGELENS_NATIVE_PROGRESS === '1') console.log(`${result.status}: ${test.title}`);
    }
    onError(error) { this.errors.push({message: error.message, stack: error.stack}); }
    onEnd(result) {
        const report = {schemaVersion: 1, config: this.config, tests: this.tests ?? [], results: [...this.results.values()],
            status: result.status, durationMs: result.duration, errors: this.errors};
        if(this.profile && !this.errors.length) {
            if(this.profile.discoveryOnly) report.profileDiscovery={directory:this.profile.directory,configDigest:this.profile.configDigest};
            else if(process.env.MAGELENS_NATIVE_PREPARE !== '1') {
                if(process.env.MAGELENS_NATIVE_PREPARE === '0') {
                    const prepared=JSON.parse(fs.readFileSync(path.join(this.profile.directory,'preflight.json')));
                    const ids=tests=>tests.map(test=>[test.id,test.expectedStatus,test.selector]);
                    if(JSON.stringify(ids(prepared.tests))!==JSON.stringify(ids(report.tests)))
                        throw new Error('Playwright inventory changed after profile preparation');
                }
                report.prediction=require('../../predictor/native.cjs').finish(this.profile.directory,report);
            }
        }
        fs.writeFileSync(process.env.MAGELENS_NATIVE_REPORT, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
    }
}
module.exports = NativeReporter;
module.exports.browserProfile = browserProfile;
