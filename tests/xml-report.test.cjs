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
test('observer coverage counts eligible registrations independently in each HTTP area', () => {
    const {manifest, record, sources} = fixture();
    const file = 'app/code/Acme/Blog/etc/events.xml';
    const source = Buffer.from('<config>\n<event name="save">\n<observer name="observer"/>\n</event>\n</config>');
    sources[file] = source;
    const registration = {event: 'save', observer: 'observer'};
    manifest.files.push({path: file, sourceHash: createHash('sha256').update(source).digest('hex'), declarations: [{
        id: 'observer', family: 'events', path: 'save/observer', declaredScope: {type: 'global', code: ''},
        startLine: 3, endLine: 3, supported: true, registration,
        areas: {global: {status: 'eligible'}, frontend: {status: 'eligible'}, adminhtml: {status: 'disabled', reason: 'disabled override'}}
    }]});
    manifest.observers = Object.fromEntries(['global', 'frontend'].map(area => [area, {save: {targets: {observer: {id: 'observer'}}}}]));
    const healthy = {...record, observerHook: true};
    const empty = merge(manifest, [healthy], sources);
    assert.deepEqual(empty.observers, {total: 2, covered: 0, hook: true});
    assert.throws(() => merge(manifest, [record], sources), /No functioning XML observer execution hook/);
    const event = {id: 'observer', type: 'observer-execute', area: 'frontend', registration, hits: 2};
    const report = merge(manifest, [{...healthy, events: [...record.events, event]}], sources);
    const [item] = report.files[1].declarations;
    assert.deepEqual(report.observers, {total: 2, covered: 1, hook: true});
    assert.deepEqual(item.areas, {global: {status: 'eligible', state: 'uncovered', hits: 0},
        frontend: {status: 'eligible', state: 'covered', hits: 2},
        adminhtml: {status: 'disabled', state: 'unmeasured', reason: 'disabled override', hits: 0}});
    assert.deepEqual(item.evidence, [{run: 'fresh', request: 'request', type: event.type, area: 'frontend', registration}]);
    for (const alteration of [{area: 'adminhtml'}, {registration: {event: 'save', observer: 'other'}}, {type: 'config-read'}]) {
        assert.throws(() => merge(manifest, [{...healthy, events: [{...event, ...alteration}]}], sources));
    }
    delete manifest.observers.frontend.save.targets.observer;
    assert.throws(() => merge(manifest, [{...healthy, events: [event]}], sources), /does not match effective provenance/);
});

test('plugin counts use declaration areas and keep line totals independent', t => {
    const {manifest, record, sources} = fixture();
    const file = 'app/code/Acme/Blog/etc/di.xml';
    const source = Buffer.from('<config>\n<type>\n<plugin\n name="shared"/>\n</type>\n</config>');
    const registration = {target: 'Acme\\Contract', name: 'shared'};
    const callback = (method, phase) => ({subject: 'Acme\\Concrete', method, phase});
    const before = callback('save', 'before'), after = callback('save', 'after'), unused = callback('unused', 'before');
    const key = ({subject, method, phase}) => createHash('sha256').update(JSON.stringify([subject, method, phase])).digest('hex');
    const callbacks = Object.fromEntries([before, after, unused].map(callback => [key(callback), callback]));
    const deferred = {...callback('stream', 'around'), reason: 'Generator callback bodies execute on iteration outside synchronous plugin coverage'};
    sources[file] = source;
    manifest.files.push({path: file, family: 'plugins', sourceHash: createHash('sha256').update(source).digest('hex'), declarations: [{
        id: 'plugin', family: 'plugins', path: 'Acme\\Contract/shared', declaredScope: {type: 'global', code: ''},
        startLine: 3, endLine: 4, supported: true, effective: true, registration,
        areas: {global: {status: 'eligible', callbacks}, frontend: {status: 'eligible', callbacks: structuredClone(callbacks),
            unmeasuredCallbacks: {[key(deferred)]: deferred}},
            adminhtml: {status: 'disabled', reason: 'disabled override', callbacks: {}}}
    }]});
    const target = {targets: {shared: {save: {before: {id: 'plugin'}, after: {id: 'plugin'}}, unused: {before: {id: 'plugin'}}}}};
    manifest.plugins = {global: {[before.subject]: target}, frontend: {[before.subject]: target}};
    const healthy = {...record, pluginHook: true};
    assert.deepEqual(merge(manifest, [healthy], sources).plugins, {total: 2, covered: 0, hook: true});
    assert.throws(() => merge(manifest, [record], sources), /No functioning XML plugin execution hook/);
    const hit = {id: 'plugin', type: 'plugin-execute', area: 'frontend', name: 'shared', callback: before, hits: 400};
    const report = merge(manifest, [{...healthy, events: [...record.events, hit],
        ambiguousPlugins: {plugin: {frontend: {[key(after)]: true}}}}], sources);
    const [item] = report.files[1].declarations;
    assert.deepEqual([report.covered, report.total], [1, 1]);
    assert.deepEqual(report.plugins, {total: 2, covered: 1, hook: true});
    assert.deepEqual(Object.values(item.areas.frontend.callbacks).map(({method, phase, state}) => [method, phase, state]),
        [['save', 'before', 'covered'], ['save', 'after', 'uncovered'], ['unused', 'before', 'uncovered']]);
    assert.equal(report.warnings.filter(warning => warning.reason?.includes('TypeError')).length, 1);
    assert.deepEqual(item.areas.frontend.unmeasuredCallbacks[key(deferred)], {...deferred, state: 'unmeasured'});
    assert.equal(report.warnings.find(warning => warning.reason?.includes(deferred.reason)).area, 'frontend');
    assert.deepEqual(item.evidence, [{run: 'fresh', request: 'request', type: 'plugin-execute', area: 'frontend', registration, callback: before}]);
    assert.equal(report.files[1].lines[3].state, 'covered');
    assert.equal(report.files[1].lines[4].state, 'covered');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-xml-plugin-report-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    writeReport(report, sources, root);
    assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /1\/2 eligible plugin registrations/);
    const html = fs.readFileSync(path.join(root, file + '.html'), 'utf8');
    assert.match(html, /#L3.*Acme\\Concrete::save · before · covered/s);
    assert.match(html, /Acme\\Concrete::stream · around · unmeasured · Generator callback bodies execute on iteration/);

    for (const altered of [{area: 'adminhtml'}, {name: 'other'}, {callback: {...before, phase: 'around'}},
        {callback: {...before, subject: 'Acme\\Other'}}, {callback: callback('stream', 'around')}, {arguments: ['forbidden']}, {type: 'config-read'}]) {
        assert.throws(() => merge(manifest, [{...healthy, events: [{...hit, ...altered}]}], sources));
    }
    assert.throws(() => merge(manifest, [healthy, {...record, events: [hit]}], sources), /without a functioning request hook/);
    delete manifest.plugins.frontend[before.subject].targets.shared.save.before;
    assert.throws(() => merge(manifest, [{...healthy, events: [hit]}], sources), /does not match effective provenance/);
});

test('preference reports validate effective routes and publish healthy zero-hit areas', t => {
    const {manifest, record, sources} = fixture();
    const file = 'app/code/Acme/Blog/etc/di.xml';
    const source = Buffer.from('<config>\n<preference for="Acme\\Container\\Contract"\n type="Acme\\Concrete"/>\n</config>');
    sources[file] = source;
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const binding = {requested: 'Acme\\Container\\Contract', replacement: 'Acme\\Concrete'};
    const origin = {id: 'binding', path: file, startLine: 2, endLine: 3, fingerprint: sourceHash};
    const eligible = {status: 'eligible', reason: null, origin, resolved: binding.replacement, effectiveReplacement: binding.replacement};
    const overridden = {status: 'overridden', reason: 'A different declaration supplies the binding',
        origin: {...origin, id: 'external', path: 'app/code/Acme/External/etc/adminhtml/di.xml'},
        resolved: 'Acme\\Admin', effectiveReplacement: 'Acme\\Admin'};
    manifest.files.push({path: file, family: 'plugins', sourceHash, declarations: [{
        id: origin.id, path: binding.requested, family: 'preferences', declaredScope: {type: 'global', code: ''},
        startLine: 2, endLine: 3, supported: true, binding, areas: {global: eligible, frontend: {...eligible}, adminhtml: overridden}
    }]});
    const requested = 'Acme\\Alias';
    manifest.preferences = {frontend: {routes: {[requested]: {ids: [origin.id], resolved: binding.replacement}}}};
    const request = {...record, preferenceHook: true};
    const event = {id: origin.id, type: 'preference-resolved', requested, area: 'frontend', hits: 12};
    const zero = merge(manifest, [request], sources);
    const result = merge(manifest, [{...request, events: [...request.events, event]}], sources);
    assert.deepEqual(zero.preferences, {total: 2, covered: 0, hook: true});
    assert.deepEqual(result.preferences, {total: 2, covered: 1, hook: true});
    assert.equal(result.total, zero.total);
    const [item] = result.files[1].declarations;
    assert.deepEqual(item.evidence[0], {run: 'fresh', request: 'request', type: event.type, area: event.area,
        requested, binding, resolved: eligible.resolved});
    assert.equal(item.areas.global.state, 'uncovered');
    assert.equal(item.areas.adminhtml.state, 'unmeasured');
    assert.equal(item.areas.frontend.hits, 12);
    assert.equal(result.files[1].lines[3].state, 'covered');
    assert.throws(() => merge(manifest, [{...request, preferenceHook: false}], sources), /No functioning XML preference/);
    for (const update of [{requested: binding.replacement}, {area: 'adminhtml'}, {area: 'global'}, {requested: '__proto__'}]) {
        assert.throws(() => merge(manifest, [{...request, events: [{...event, ...update}]}], sources), /provenance|ineligible/);
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-xml-preference-report-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    writeReport(result, sources, root);
    assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /1\/2 eligible declaration–area pairs resolved/);
    assert.match(fs.readFileSync(path.join(root, file + '.html'), 'utf8'), /id="L3" class="line covered"/);
    writeReport(zero, sources, root);
    assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /0\/2 eligible declaration–area pairs resolved/);
});
