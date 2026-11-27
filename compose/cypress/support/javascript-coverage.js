// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Keep every page's actual Istanbul map by identity. Magento loads AMD modules
// after window:load, and its Admin Prototype library changes Array#toJSON.
// The standard browser hook's deep comparison can collapse distinct empty maps.
// Use the maintained plugin's merge/report tasks with plain snapshots instead.
const {sparseCounters} = require('../../bin/javascript-attempts.cjs');
const {currentAttempt} = require('./attempt');
let pages = new Set();

before(() => cy.task('resetCoverage', {isInteractive: Cypress.config('isInteractive')}, {log: false}));
beforeEach(() => { pages = new Set(); });
Cypress.on('window:before:load', win => {
    const coverage = {};
    win.__coverage__ = coverage;
    pages.add(coverage);
});
afterEach(() => {
    const attempt = currentAttempt();
    for (const coverage of pages) {
        if (Object.keys(coverage).length) {
            // Clone into the test runner's realm before serializing. This keeps
            // branch arrays as arrays despite Prototype's legacy toJSON method.
            const snapshot = structuredClone(coverage);
            cy.task('combineCoverage', JSON.stringify(snapshot), {log: false});
            // The same page counters, kept per test attempt; see docs/coverage.md#test-attempts.
            if (attempt) cy.task('mageLensAttemptJavascript', {id: attempt, counters: sparseCounters(snapshot)}, {log: false});
        }
    }
});
after(() => cy.task('coverageReport', null, {log: false, timeout: 180000}));
