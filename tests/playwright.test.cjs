// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Reporter = require('../playwright/reporter.cjs');
const {isCoverageExcluded} = require('../bin/project.cjs');

test('Playwright report distinguishes failed, skipped and unexecuted tests from passes', t => {
    const cwd = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-playwright-report-'));
    t.after(() => {process.chdir(cwd); fs.rmSync(root, {recursive: true, force: true});});
    process.chdir(root);
    fs.mkdirSync('coverage');
    fs.writeFileSync('coverage/run.json', JSON.stringify({id: 'current-run'}));
    const states = ['passed', 'failed', 'timedOut', 'interrupted', 'skipped', null];
    const reporter = new Reporter();
    reporter.onBegin({}, {allTests: () => states.map((status, index) => ({
        title: `scenario ${index}`, results: status ? [{status}] : [], location: {file: `spec-${index}.js`}
    }))});
    reporter.onEnd({status: 'failed'});
    const result = JSON.parse(fs.readFileSync('coverage/playwright-results.json'));
    assert.equal(result.run, 'current-run');
    assert.equal(result.runner, 'playwright');
    assert.equal(result.totalTests, 6);
    assert.equal(result.totalPassed, 1);
    assert.equal(result.totalFailed, 3);
    assert.equal(result.totalSkipped, 1);
    assert.equal(result.totalPending, 1);
    assert.deepEqual(result.tests, states.map((status, index) => ({title: `scenario ${index}`, status: status || 'pending'})));
});

test('Playwright specs and support code cannot inflate application coverage', () => {
    for (const file of ['app/code/Client/Module/Test/Playwright/cart.spec.js', 'app/design/frontend/Client/shop/web/cart.spec.ts', 'app/design/frontend/Client/shop/web/playwright/support.js']) {
        assert.equal(isCoverageExcluded(file), true, file);
    }
    assert.equal(isCoverageExcluded('app/design/frontend/Client/shop/web/js/cart.js'), false);
});
