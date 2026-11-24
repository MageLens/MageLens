// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {merge} = require('../bin/report-xml.cjs');
const reportFile = path.resolve(process.argv[2] || 'coverage/xml/coverage.json');
const coverage = path.dirname(path.dirname(reportFile));
const root = path.dirname(coverage);
const manifest = JSON.parse(fs.readFileSync(path.join(coverage, 'xml-manifest.json')));
const raw = path.join(coverage, 'raw/php');
const records = fs.readdirSync(raw, {recursive: true}).filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(fs.readFileSync(path.join(raw, file))).xml)
    .filter(record => record?.layoutLimitations?.includes('full-page-cache-origin'));
assert.ok(records.length > 0, 'Native cache-only request is absent');
const sources = Object.fromEntries(manifest.files.map(file => [file.path,
    fs.readFileSync(path.join(root, 'src', file.path))]));
for (const record of records) {
    assert.equal(record.layoutHook, true);
    assert.equal(record.layoutSourceTrace, false);
    assert.equal(record.events.some(event => event.type.startsWith('layout-')), false);
    const result = merge(manifest, [record], sources);
    assert.equal(result.layout.covered, 0);
    assert.ok(result.layout.total > 0);
    assert.ok(result.layout.limitations.some(reason => reason.startsWith('A native full-page cache lookup returned a response.')));
    for (const file of result.files) {
        for (const item of file.declarations.filter(item => item.family === 'layout')) {
            assert.equal(item.hits, 0, `${file.path}/${item.node}`);
            assert.deepEqual(item.evidence, [], `${file.path}/${item.node}`);
            if (item.supported) assert.equal(item.state, 'uncovered', `${file.path}/${item.node}`);
        }
    }
}
console.log('Verified complete XML reports from real cache-only HTTP requests preserve zero-hit layout inventory and hook health.');
