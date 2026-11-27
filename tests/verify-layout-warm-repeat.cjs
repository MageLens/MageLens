// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {readXmlJson} = require(projectFile('bin/xml-report/json.cjs'));

const firstRun = readXmlJson(process.argv[2], {omit: ['requests']});
const warm = readXmlJson('coverage/xml/coverage.json', {omit: ['requests']});
const run = JSON.parse(fs.readFileSync('coverage/run.json', 'utf8'));
assert.notEqual(run.id, firstRun.run, 'Warm repeat reused a prior run ID');
assert.equal(warm.run, run.id);
assert.equal(warm.complete, true);
assert.equal(warm.sourcesUnchanged, true);
assert.deepEqual(warm.collectorErrors, []);

for (const report of [firstRun, warm]) {
    for (const handle of ['blog_index_index', 'blog_post_view']) {
        const file = report.files.find(item => item.path === `app/code/Application/Blog/view/frontend/layout/${handle}.xml`);
        assert.ok(file, `Missing original source for ${handle}`);
        for (const [kind, event] of [['block', 'layout-block-rendered'], ['template', 'layout-template-executed'],
            ['argument', 'layout-argument-applied']]) {
            const item = file.declarations.find(entry => entry.layout?.kind === kind);
            assert.equal(item?.state, 'covered', `${handle}/${kind} in run ${report.run}`);
            assert.ok(item.evidence.some(entry => entry.run === report.run && entry.type === event),
                `Missing current-run native ${event} for ${handle}`);
        }
    }
}
console.log('Verified current-run block, template and argument effects on both default and warm storefront runs.');
