// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Reporter = require(projectFile('playwright/reporter.cjs'));
const {isCoverageExcluded} = require(projectFile('bin/project.cjs'));
const {observeStorefrontReadiness} = require(projectFile('src/app/code/Application/Blog/Test/storefront-readiness.cjs'));

test('storefront readiness observes both real message sources in either order and resets for each document', () => {
    for (const order of [['messages-loaded', 'private-content-loaded'], ['private-content-loaded', 'messages-loaded']]) {
        const document = new EventTarget();
        observeStorefrontReadiness(document);
        document.dispatchEvent(new Event('load'));
        assert.deepEqual(document.__magelensStorefrontReady, {messages: false, privateContent: false});
        document.dispatchEvent(new Event(order[0]));
        assert.equal(Object.values(document.__magelensStorefrontReady).every(Boolean), false);
        document.dispatchEvent(new Event(order[1]));
        assert.deepEqual(document.__magelensStorefrontReady, {messages: true, privateContent: true});
    }
});

test('Playwright report counts outcomes, including expected failures, and distinguishes unexecuted tests', t => {
    const cwd = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-playwright-report-'));
    t.after(() => {process.chdir(cwd); fs.rmSync(root, {recursive: true, force: true});});
    process.chdir(root);
    fs.mkdirSync('coverage');
    fs.writeFileSync('coverage/run.json', JSON.stringify({id: 'current-run'}));
    // [last result status, Playwright outcome, reported state]; test.fail() makes a failure expected.
    const states = [['passed', 'expected', 'passed'], ['failed', 'unexpected', 'failed'], ['timedOut', 'unexpected', 'failed'],
        ['interrupted', 'skipped', 'failed'], ['skipped', 'skipped', 'skipped'], [null, 'skipped', 'pending'],
        ['failed', 'expected', 'passed'], ['passed', 'unexpected', 'failed'], ['passed', 'flaky', 'passed']];
    const reporter = new Reporter();
    reporter.onBegin({}, {allTests: () => states.map(([status, outcome], index) => ({
        title: `scenario ${index}`, results: status ? [{status}] : [], outcome: () => outcome, location: {file: `spec-${index}.js`},
        annotations: [{type: 'magelens-browser', description: JSON.stringify({name: 'chrome', version: '156.0.8078.80'})}]
    }))});
    reporter.onEnd({status: 'failed'});
    const result = JSON.parse(fs.readFileSync('coverage/playwright-results.json'));
    assert.equal(result.run, 'current-run');
    assert.equal(result.runner, 'playwright');
    assert.deepEqual(result.browser, {name: 'chrome', version: '156.0.8078.80'});
    assert.equal(result.totalTests, 9);
    assert.equal(result.totalPassed, 3);
    assert.equal(result.totalFailed, 4);
    assert.equal(result.totalSkipped, 1);
    assert.equal(result.totalPending, 1);
    assert.deepEqual(result.tests, states.map(([, , state], index) => ({title: `scenario ${index}`, status: state})));
});

test('Playwright specs and support code cannot inflate application coverage', () => {
    for (const file of ['app/code/Client/Module/Test/Playwright/cart.spec.js', 'app/design/frontend/Client/shop/web/cart.spec.ts', 'app/design/frontend/Client/shop/web/playwright/support.js']) {
        assert.equal(isCoverageExcluded(file), true, file);
    }
    assert.equal(isCoverageExcluded('app/design/frontend/Client/shop/web/js/cart.js'), false);
});
