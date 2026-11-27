// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
function check(file, node, covered, types) {
    const item = file.declarations.find(item => item.node === node);
    assert.ok(item, node);
    assert.equal(item.hits > 0, covered, node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), types.sort(), node);
}
for (const fixtureCase of ['body', 'interpreter', 'partial', 'dispatch', 'type', 'denied', 'success']) {
    const file = report.files.find(file => file.path.endsWith(`/layout/coverageprobe_actionfailure_${fixtureCase}.xml`));
    assert.ok(file, fixtureCase);
    const first = '/layout/block/action[1]';
    const succeeds = fixtureCase === 'success';
    const failed = !['success', 'denied'].includes(fixtureCase);
    const actionTypes = succeeds ? ['layout-action-executed'] : failed
        ? ['layout-action-' + (['interpreter', 'partial'].includes(fixtureCase) ? 'evaluation-failed' : 'completion-failed')] : [];
    for (const suffix of ['', '/@method']) check(file, first + suffix, succeeds, actionTypes);
    for (const position of fixtureCase === 'partial' ? [1, 2, 3] : [null]) {
        const evaluated = ['body', 'dispatch', 'type'].includes(fixtureCase) || (fixtureCase === 'partial' && position === 1);
        const argument = '/argument' + (position === null ? '' : `[${position}]`);
        for (const [suffix, family] of [[argument, 'argument'], [argument + '/@name', 'argument-name']]) {
            const types = succeeds ? [`layout-action-${family}-applied`] : evaluated
                ? [`layout-action-${family}-evaluated`] : failed ? [`layout-action-${family}-evaluation-incomplete`] : [];
            check(file, first + suffix, succeeds || evaluated, types);
        }
    }
    const after = ['success', 'denied'].includes(fixtureCase);
    for (const suffix of ['', '/@method']) check(file, '/layout/block/action[2]' + suffix, after, after ? ['layout-action-executed'] : []);
    if (fixtureCase === 'denied') check(file, first + '/@ifconfig', true, ['layout-action-condition-denied']);
}
console.log('Verified failed action evaluation, native dispatch limitations, evaluated values and suppressed later calls independently of successful completion.');
