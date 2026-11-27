// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));
const report = readXmlJson(process.argv[2] || 'coverage/xml/coverage.json', {omit: ['requests']});
const scope = process.argv[3] || 'all';
function source(variant) {
    const file = report.files.find(file => file.path === `app/code/MageLens/Compatibility/view/frontend/layout/coverageprobe_sharedactions${variant === 'guarded' ? '' : '_' + variant}.xml`);
    assert.ok(file, variant);
    return file;
}
function check(file, node, kind, covered, types) {
    const item = file.declarations.find(item => item.node === node);
    assert.ok(item, node);
    assert.equal(item.layout.kind, kind, node);
    assert.equal(item.hits > 0, covered, node);
    assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), types.sort(), node);
}
if (['all', 'guarded'].includes(scope)) {
    const file = source('guarded');
    for (const [index, allowed] of [[2, false], [1, true]]) {
        const node = `/layout/container/block[${index}]/action`;
        check(file, node, 'action', allowed, allowed ? ['layout-action-executed'] : []);
        check(file, node + '/@method', 'action-method', allowed, allowed ? ['layout-action-executed'] : []);
        check(file, node + '/@ifconfig', 'action-ifconfig', true, [`layout-action-condition-${allowed ? 'allowed' : 'denied'}`]);
        for (const position of [1, 2]) {
            check(file, node + `/argument[${position}]`, 'action-argument', allowed, allowed ? ['layout-action-argument-applied'] : []);
            check(file, node + `/argument[${position}]/@name`, 'action-argument-name', allowed, allowed ? ['layout-action-argument-name-applied'] : []);
        }
    }
}
for (const variant of ['unguarded', 'distinct']) {
    if (scope !== 'all' && scope !== variant) continue;
    const file = source(variant);
    const covered = variant === 'distinct';
    for (const index of [1, 2]) {
        const node = `/layout/container/block[${index}]/action`;
        const effect = covered ? 'executed' : 'ambiguous';
        check(file, node, 'action', covered, ['layout-action-' + effect]);
        check(file, node + '/@method', 'action-method', covered, ['layout-action-' + effect]);
        for (const position of [1, 2]) {
            check(file, node + `/argument[${position}]`, 'action-argument', covered, ['layout-action-argument-' + (covered ? 'applied' : 'ambiguous')]);
            check(file, node + `/argument[${position}]/@name`, 'action-argument-name', covered, ['layout-action-argument-name-' + (covered ? 'applied' : 'ambiguous')]);
        }
    }
}
console.log('Verified action ownership across shared object aliases, independent of equal method/argument values and opposite guard decisions.');
