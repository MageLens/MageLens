// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {replaceBadgeSection, badge, cypressBadge, testOutcome} = require(projectFile('bin/badges.cjs'));

test('badge refresh preserves all README content outside the managed region', () => {
    const start = '<!-- coverage-badges:start -->';
    const end = '<!-- coverage-badges:end -->';
    const before = '# Hand-written introduction\n\n';
    const after = '\n\n## Installation\nKeep this exactly.\n';
    assert.equal(replaceBadgeSection(`${before}${start}\nold result\n${end}${after}`, 'new result'),
        `${before}${start}\nnew result\n${end}${after}`);
});

test('missing, duplicate and reversed markers fail without rewriting README', () => {
    const start = '<!-- coverage-badges:start -->';
    const end = '<!-- coverage-badges:end -->';
    for (const input of ['', start, `${start}${start}${end}`, `${end}${start}`]) {
        assert.throws(() => replaceBadgeSection(input, 'replacement'));
    }
});

test('SVG values derive from the supplied report and invalid metrics are rejected', () => {
    assert.match(badge('php', 37.125), /37\.13%/);
    assert.match(badge('templates', 0), /0\.00%/);
    assert.match(badge('templates', null), /Template executable lines: N\/A/);
    assert.match(badge('templates', null), /fill="#555"/);
    for (const value of [undefined, NaN, Infinity, -1, 101]) {
        assert.throws(() => badge('php', value));
    }
});

test('Cypress badge derives its rate and status from executed tests only', () => {
    const results = {totalTests: 8, totalPassed: 8, totalFailed: 0, totalPending: 0, totalSkipped: 0};
    assert.match(cypressBadge(results), /100% \(8\/8\) - Passed/);
    assert.match(cypressBadge({...results, totalPassed: 6, totalFailed: 2}), /75% \(6\/8\) - Failed/);
    assert.match(cypressBadge({...results, totalPassed: 7, totalSkipped: 1}), /100% \(7\/7\) - Passed/);
    assert.match(cypressBadge({...results, totalPassed: 5, totalFailed: 1, totalPending: 2}), /83\.33% \(5\/6\) - Failed/);
    assert.match(cypressBadge({...results, status: 'failed'}), /Failed/);
    assert.throws(() => cypressBadge({...results, totalTests: 9}), /Invalid/);
    assert.throws(() => cypressBadge({...results, totalSkipped: undefined}), /Invalid/);
    assert.throws(() => cypressBadge({...results, totalTests: 0, totalPassed: 0}), /Invalid/);
    assert.throws(() => cypressBadge({...results, totalPassed: 0, totalSkipped: 8}), /Invalid/);
});

test('test outcomes list the failed tests and ignore skipped and pending ones', () => {
    const tests = [{title: 'a', status: 'passed'}, {title: 'b', status: 'failed'}, {title: 'c', status: 'timedOut'},
        {title: 'd', status: 'interrupted'}, {title: 'e', status: 'skipped'}, {title: 'f', status: 'pending'}];
    assert.deepEqual(testOutcome({totalTests: 6, totalPassed: 1, totalFailed: 3, totalPending: 1, totalSkipped: 1, tests}),
        {status: 'failed', passed: 1, failed: 3, failedTests: ['b', 'c', 'd']});
    assert.deepEqual(testOutcome({totalTests: 0, totalPassed: 0, totalFailed: 0, totalPending: 0, totalSkipped: 0}),
        {status: 'passed', passed: 0, failed: 0, failedTests: []});
    assert.throws(() => testOutcome({totalTests: 1, totalPassed: 0, totalFailed: 0, totalPending: 0, totalSkipped: 0}), /Invalid/);
});
