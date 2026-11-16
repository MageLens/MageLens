// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {merge, writeReport} = require('../bin/report-xml.cjs');
function fixture() {
    const file = 'app/code/Acme/Blog/etc/config.xml';
    const source = '<config>\n<first>used</first><second>unused</second>\n<!-- <script>unsafe</script> -->\n</config>';
    const sha = createHash('sha256').update(source).digest('hex');
    const declaration = (id, startLine, endLine, supported = true) => ({id, path: `blog/display/${id}`, family: 'config', declaredScope: {type: 'default', code: ''}, startLine, endLine, supported});
    return {sources: {[file]: Buffer.from(source)}, manifest: {id: 'manifest', run: 'fresh', files: [{path: file, sourceHash: sha,
        declarations: [declaration('first', 2, 2), declaration('second', 2, 2), declaration('unsupported', 3, 3, false)]}]},
        record: {run: 'fresh', manifest: 'manifest', request: 'request', readHook: true, events: [
            {id: 'first', type: 'config-read', requestedScope: {type: 'stores', code: 'reading'}, hits: 2}
        ]}};
}
test('XML line unions preserve uncovered declarations and neutral/unsupported lines', () => {
    const {manifest, record, sources} = fixture();
    const result = merge(manifest, [record], sources);
    assert.equal(result.covered, 1); assert.equal(result.total, 1);
    assert.equal(result.files[0].lines[2].state, 'covered');
    assert.equal(result.files[0].declarations[1].state, 'uncovered');
    assert.equal(result.files[0].lines[3].state, 'unmeasured');
    assert.equal(result.files[0].lines[1], undefined);
    assert.equal(result.files[0].declarations[0].evidence[0].requestedScope.code, 'reading');
});
test('XML reports reject stale, unknown, incomplete and changed-source evidence', () => {
    const {manifest, record, sources} = fixture();
    for (const patch of [{run: 'old'}, {manifest: 'old'}, {readHook: false}, {events: [{...record.events[0], id: 'unknown'}]},
        {events: [{...record.events[0], id: 'unsupported'}]}, {events: [{...record.events[0], hits: -1}]}]) {
        assert.throws(() => merge(manifest, [{...record, ...patch}], sources));
    }
    assert.throws(() => merge(manifest, [], sources));
    assert.throws(() => merge(manifest, [record], {[manifest.files[0].path]: Buffer.from('changed')}), /source changed/);
});
test('XML HTML preserves nested directories, source anchors, escaping and line colors', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-xml-report-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const {manifest, record, sources} = fixture();
    writeReport(merge(manifest, [record], sources), sources, root);
    for (const file of ['index.html', 'app/index.html', 'app/code/index.html', 'app/code/Acme/Blog/etc/index.html']) {
        assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /<html/);
    }
    const source = fs.readFileSync(path.join(root, manifest.files[0].path + '.html'), 'utf8');
    assert.match(source, /id="L2" class="line covered"/);
    assert.match(source, /&lt;script&gt;unsafe/);
    assert.doesNotMatch(source, /<script>unsafe/);
});
test('warm repeat frequencies do not grant credit to unvisited declarations', () => {
    const {manifest, record, sources} = fixture();
    const cold = merge(manifest, [record], sources), warm = merge(manifest, [{...record, events: [{...record.events[0], hits: 90}]}], sources);
    assert.deepEqual(cold.files[0].declarations.map(item => item.state), warm.files[0].declarations.map(item => item.state));
});
