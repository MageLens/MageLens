// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

// Runs a browser suite script against stub runner packages, so only its exit status is under test.
function suite(t, script, stubs, args = [], env = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-suite-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const write = (file, content) => {
        fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
        fs.writeFileSync(path.join(root, file), content);
    };
    write(`bin/${script}`, fs.readFileSync(path.resolve(__dirname, '../bin', script)));
    write('bin/project.cjs', `module.exports = {specPatterns: () => ['cypress/e2e/*.cy.js'], warmupPaths: () => ['/']};`);
    write('coverage/run.json', JSON.stringify({id: 'current-run'}));
    write('coverage/project-fixtures.json', '{}');
    for (const [file, content] of Object.entries(stubs)) write(file, content);
    return spawnSync(process.execPath, [`bin/${script}`, ...args], {cwd: root, encoding: 'utf8', env: {...process.env, ...env}});
}

function cypress(t, tests, args = []) {
    const counts = state => tests.filter(test => test.state === state).length;
    const results = {browserName: 'chrome-for-testing', browserVersion: '1', status: 'finished',
        totalTests: tests.length, totalPassed: counts('passed'), totalFailed: counts('failed'), totalPending: counts('pending'), totalSkipped: counts('skipped'),
        runs: [{spec: {relative: args.includes('--warmup') ? 'cypress/warmup/storefront.cy.js' : 'cypress/e2e/shop.cy.js'}, tests}]};
    return suite(t, 'run-browser.cjs', {
        'cypress/e2e/shop.cy.js': '',
        'node_modules/cypress/index.js': `module.exports = {run: async () => (${JSON.stringify(results)})};`,
        'docker/runner/cypress-source/provenance.cjs': 'module.exports = {verifyInstalled: () => null};'
    }, args);
}

const attempt = (title, state) => ({title: [title], state});

test('Cypress: skipped and pending tests do not fail the suite', t => {
    const result = cypress(t, [attempt('passes', 'passed'), attempt('is skipped', 'pending'), attempt('follows a failed hook', 'skipped')]);
    assert.equal(result.status, 0, result.stderr);
});

test('Cypress: a failed test fails the suite', t => {
    const result = cypress(t, [attempt('passes', 'passed'), attempt('fails', 'failed')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /The full Cypress suite did not pass/);
});

test('Cypress: the warm-up still requires every test to pass', t => {
    const result = cypress(t, [attempt('warms', 'passed'), attempt('is skipped', 'pending')], ['--warmup']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Browser warm-up did not pass/);
});

function playwright(t, results, status) {
    return suite(t, 'run-playwright.cjs', {
        'bin/browser-navigation.cjs': 'module.exports = {};',
        'node_modules/@playwright/test/index.js': 'module.exports = {chromium: null};',
        'node_modules/@playwright/test/cli.js': `require('node:fs').writeFileSync('coverage/playwright-results.json', ${JSON.stringify(JSON.stringify(results))});
process.exitCode = ${status};`
    });
}

const counts = {run: 'current-run', runner: 'playwright', totalTests: 3, totalPassed: 2, totalFailed: 0, totalPending: 0, totalSkipped: 1};

test('Playwright: skipped tests do not fail the suite', t => {
    const result = playwright(t, {...counts, status: 'passed'}, 0);
    assert.equal(result.status, 0, result.stderr);
});

test('Playwright: a failed test or an unfinished run fails the suite', t => {
    assert.equal(playwright(t, {...counts, totalPassed: 1, totalFailed: 1, status: 'failed'}, 1).status, 1);
    assert.equal(playwright(t, {...counts, totalSkipped: 0, totalPending: 1, status: 'timedout'}, 0).status, 1);
});
