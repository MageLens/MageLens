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

test('virtual and constructor usage require live evidence and preserve independent totals and source highlights', t => {
    const {manifest, record, sources} = fixture();
    const file = 'app/code/Acme/Blog/etc/di.xml';
    sources[file] = Buffer.from('<config>\n<virtualType name="AcmeAlias" type="AcmeType">\n <argument/>\n</virtualType>\n</config>');
    const fingerprint = createHash('sha256').update(sources[file]).digest('hex');
    const virtual = {id: 'virtual', family: 'virtual-types', binding: {requested: 'AcmeAlias', replacement: 'AcmeType'},
        path: 'AcmeAlias', startLine: 2, endLine: 4, highlightEndLine: 2};
    const argument = {id: 'argument', family: 'arguments', binding: {declaringType: 'AcmeAlias', argument: 'unused'},
        path: 'AcmeAlias/unused', startLine: 3, endLine: 3};
    const arrayItem = {id: 'item', family: 'arguments', binding: {declaringType: 'AcmeAlias', argument: 'items', items: ['nested', 'key']},
        path: 'AcmeAlias/items[nested][key]', startLine: 3, endLine: 3};
    const lifetime = {id: 'lifetime', family: 'lifecycles', binding: {declaringType: 'AcmeAlias', shared: false},
        path: 'AcmeAlias', startLine: 2, endLine: 2};
    for (const item of [virtual, argument, arrayItem, lifetime]) {
        Object.assign(item, {declaredScope: {type: 'frontend', code: ''}, supported: true, areas: {frontend: {
            status: 'eligible', origin: {id: item.id, path: file, startLine: item.startLine, endLine: item.endLine, fingerprint},
            resolved: item === virtual ? 'AcmeType' : null
        }}});
    }
    const diUsage = {eligible: {'virtual-types': {virtual: true}, arguments: {argument: true, item: true}, lifecycles: {lifetime: true}},
        virtualRoutes: {AcmeAlias: {ids: ['virtual'], resolved: 'AcmeType'}}};
    manifest.preferences = {frontend: {routes: {}, diUsage}};
    manifest.files.push({path: file, family: 'plugins', sourceHash: fingerprint, declarations: [virtual, argument, arrayItem, lifetime]});
    const healthy = {...record, preferenceHook: true, diUsageHooks: {'virtual-types': true, arguments: true, lifecycles: true}};
    const resolution = {id: 'virtual', type: 'virtual-type-resolved', area: 'frontend', requested: 'AcmeAlias', hits: 1};
    const report = merge(manifest, [{...healthy, events: [...record.events, resolution]}], sources);
    assert.deepEqual(report.virtualTypes, {total: 1, covered: 1, hook: true});
    assert.deepEqual(report.arguments, {total: 2, covered: 0, hook: true});
    assert.deepEqual(report.lifecycles, {total: 1, covered: 0, hook: true});
    assert.equal(report.files[1].lines[2].state, 'covered');
    assert.equal(report.files[1].lines[3].state, 'uncovered');
    assert.equal(report.files[1].lines[4], undefined);
    assert.equal(report.files[1].total, 0);
    assert.throws(() => merge(manifest, [{...healthy, diUsageHooks: {'virtual-types': true}}], sources), /constructor argument usage hook/);
    assert.throws(() => merge(manifest, [{...healthy, events: [{...resolution, requested: 'AcmeType'}]}], sources), /factory route/);
    const applied = {id: 'argument', type: 'argument-applied', area: 'frontend', requested: 'AcmeAlias', hits: 3};
    assert.throws(() => merge(manifest, [{...healthy, events: [{...applied, value: 'secret'}]}], sources));
    const policy = {id: 'lifetime', type: 'lifetime-applied', area: 'frontend', requested: 'AcmeAlias', hits: 1};
    const populated = merge(manifest, [{...healthy, events: [applied, {...applied, id: 'item'}, policy]}], sources);
    assert.deepEqual(populated.arguments, {total: 2, covered: 2, hook: true});
    assert.deepEqual(populated.lifecycles, {total: 1, covered: 1, hook: true});
    assert.throws(() => merge(manifest, [{...healthy, events: [{...policy, id: 'item'}]}], sources));
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-xml-di-usage-'));
    t.after(() => fs.rmSync(output, {recursive: true, force: true}));
    writeReport(report, sources, output);
    const index = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    assert.match(index, /Virtual type usage/);
    assert.match(index, /Constructor argument usage/);
    assert.match(index, /\$items\[&quot;nested&quot;\]\[&quot;key&quot;\]/);
    assert.match(index, /Object lifetime usage/);
    assert.match(index, /New instance/);
});

test('layout reports validate effects and keep superseded and zero-hit declarations visible', () => {
    const {manifest, record, sources} = fixture();
    const file = 'app/code/Acme/Blog/view/frontend/layout/blog_index_index.xml';
    const source = Buffer.from('<page><body><block name="blog" template="a.phtml"/></body></page>');
    const declaration = (id, kind) => ({id, family: 'layout', path: '/page/body/block', startLine: 1, endLine: 1,
        declaredScope: {type: 'frontend', code: ''}, layout: {kind, element: 'blog', ordinal: 2, handle: 'blog_index_index',
            fileType: 'page', instruction: 'block'}, supported: true});
    const sourceHash = createHash('sha256').update(source).digest('hex');
    manifest.files.push({path: file, sourceHash, family: 'layout',
        declarations: [declaration('created', 'block'), declaration('template', 'template')]});
    manifest.layoutSources = {[file]: {hash: sourceHash,
        targets: {2: {ids: {block: 'created', template: 'template'}}}}};
    sources[file] = source;
    const healthy = {...record, layoutHook: true};
    assert.throws(() => merge(manifest, [record], sources), /No functioning XML layout hook/);
    const empty = merge(manifest, [healthy], sources);
    assert.deepEqual(empty.layout, {total: 2, covered: 0, hook: true, limitations: []});
    assert.deepEqual(empty.files[1].declarations.map(item => item.state), ['uncovered', 'uncovered']);
    const context = {area: 'frontend', theme: 'frontend/Acme/theme', hits: 1};
    const block = {id: 'created', type: 'layout-block-created', ...context};
    const overridden = {id: 'template', type: 'layout-template-overridden', ...context};
    const current = {...healthy, events: [block, {...block, type: 'layout-block-rendered'}, overridden]};
    const actual = merge(manifest, [current], sources);
    assert.deepEqual(actual.layout, {total: 1, covered: 1, hook: true, limitations: []});
    assert.deepEqual(actual.files[1].declarations.map(item => item.state), ['covered', 'unmeasured']);
    assert.equal(actual.files[1].declarations[1].evidence[0].type, overridden.type);
    assert.equal(actual.files[1].total, 0);
    for (const invalid of [{...block, type: 'layout-template-executed'}, {...block, id: 'unknown'},
        {...block, theme: 'incorrect'}, {...block, unexpectedValue: 'private'}]) {
        assert.throws(() => merge(manifest, [{...current, events: [invalid]}], sources));
    }
    assert.throws(() => merge(manifest, [{...current, run: 'stale'}], sources), /Stale XML request/);
    assert.throws(() => merge(manifest, [current], {...sources, [file]: Buffer.from('edited')}), /XML source changed/);
    delete manifest.layoutSources[file].targets[2].ids.block;
    assert.throws(() => merge(manifest, [current], sources), /does not match manifest provenance/);
});

test('creation and template selection remain facts without granting rendering credit', t => {
    const {manifest, record, sources} = fixture();
    const file = 'app/code/Acme/Blog/view/frontend/layout/unrendered.xml';
    const source = Buffer.from('<layout><block name="unrendered" template="unvisited.phtml"/></layout>');
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const declaration = kind => ({id: kind, family: 'layout', path: '/layout/block', node: '/layout/block',
        startLine: 1, endLine: 1, supported: true, declaredScope: {type: 'frontend', code: ''},
        layout: {kind, element: 'unrendered', ordinal: 1, handle: 'unrendered', fileType: 'generic', instruction: 'block'}});
    manifest.files.push({path: file, sourceHash, family: 'layout', declarations: ['block', 'template'].map(declaration)});
    manifest.layoutSources = {[file]: {hash: sourceHash, targets: {1: {ids: {block: 'block', template: 'template'}}}}};
    sources[file] = source;
    const event = (id, type) => ({id, type, hits: 1, area: 'frontend', theme: 'frontend/Acme/theme'});
    const facts = [event('block', 'layout-block-created'), event('template', 'layout-template-selected')];
    const collect = events => merge(manifest, [{...record, layoutHook: true, events}], sources);
    const unrendered = collect(facts);
    assert.deepEqual(unrendered.files[1].declarations.map(item => [item.state, item.hits]), [['uncovered', 0], ['uncovered', 0]]);
    assert.deepEqual(unrendered.files[1].declarations.map(item => item.evidence[0].type), ['layout-block-created', 'layout-template-selected']);
    assert.equal(unrendered.layout.covered, 0);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-layout-facts-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    writeReport(unrendered, sources, directory);
    const html = fs.readFileSync(path.join(directory, file + '.html'), 'utf8');
    assert.match(html, /uncovered<small>block created · observed fact/);
    assert.match(html, /uncovered<small>template selected · observed fact/);
    const replaced = collect([...facts, event('template', 'layout-template-replaced')]);
    assert.equal(replaced.files[1].declarations[1].state, 'unmeasured');
    assert.equal(replaced.files[1].declarations[1].hits, 0);
    for (const dependency of ['resolver', 'context', 'engine-pool']) {
        const limited = collect([...facts, event('template', `layout-template-${dependency}-storage-unconfirmed`)]);
        const declaration = limited.files[1].declarations[1];
        assert.equal(declaration.state, 'unmeasured');
        assert.equal(declaration.hits, 0);
        assert.match(declaration.reason, /backing/);
    }
    const failed = collect([...facts, event('block', 'layout-block-render-failed')]);
    assert.equal(failed.files[1].declarations[0].state, 'unmeasured');
    assert.equal(failed.files[1].declarations[0].hits, 0);
    const rendered = collect([...facts, event('block', 'layout-block-rendered'), event('template', 'layout-template-executed')]);
    assert.deepEqual(rendered.files[1].declarations.map(item => [item.state, item.hits]), [['covered', 1], ['covered', 1]]);
    assert.equal(rendered.layout.covered, 2);
});

test('XML reporting rejects a symlink to an otherwise identical layout source', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-xml-layout-link-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const file = 'app/code/Acme/Blog/view/frontend/layout/blog_index_index.xml';
    const filename = path.join(root, 'src', file);
    const raw = path.join(root, 'coverage/raw/php/fresh');
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.mkdirSync(raw, {recursive: true});
    const bytes = '<page><body/></page>';
    const original = path.join(root, 'original.xml');
    fs.writeFileSync(original, bytes);
    fs.symlinkSync(original, filename);
    fs.writeFileSync(path.join(root, 'coverage/run.json'), JSON.stringify({id: 'fresh'}));
    fs.writeFileSync(path.join(root, 'coverage/xml-manifest.json'), JSON.stringify({
        run: 'fresh', files: [{path: file, sourceHash: createHash('sha256').update(bytes).digest('hex')}]
    }));
    const {spawnSync} = require('node:child_process');
    const result = spawnSync(process.execPath, [require.resolve('../bin/report-xml.cjs')], {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Symlinked XML source/);
});

test('reference target observations retain zero hits and require independent native effects', () => {
    for (const kind of ['reference', 'reference-name']) {
        const {manifest, record, sources} = fixture();
        const file = 'app/code/Acme/Blog/view/frontend/layout/references.xml';
        const source = Buffer.from('<layout><referenceBlock name="subject"/></layout>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        manifest.files.push({path: file, sourceHash, family: 'layout', declarations: [{
            id: 'reference', family: 'layout', path: '/layout/referenceBlock', startLine: 1, endLine: 1,
            supported: true, declaredScope: {type: 'frontend', code: ''},
            layout: {kind, element: 'subject', ordinal: 1, handle: 'references', fileType: 'generic', instruction: 'referenceBlock'}
        }]});
        manifest.layoutSources = {[file]: {hash: sourceHash, targets: {1: {ids: {[kind]: 'reference'}}}}};
        sources[file] = source;
        const event = type => ({id: 'reference', type, area: 'frontend', theme: 'frontend/Acme/theme', hits: 1});
        const collect = types => merge(manifest, [{...record, layoutHook: true, events: types.map(event)}], sources)
            .files[1].declarations[0];
        for (const types of [[], ['layout-reference-target-observed'], ['layout-template-selected']]) {
            const declaration = collect(types);
            assert.equal(declaration.state, 'uncovered');
            assert.equal(declaration.hits, 0);
        }
        for (const type of ['layout-reference-unchanged', 'layout-reference-target-missing',
            'layout-reference-target-removed', 'layout-reference-origin-unconfirmed', 'layout-reference-child-replaced']) {
            const declaration = collect([type]);
            assert.equal(declaration.state, 'unmeasured');
            assert.equal(declaration.hits, 0);
            assert.ok(declaration.reason);
        }
        for (const type of ['layout-reference-child-attached', 'layout-template-executed', 'layout-action-executed',
            'layout-container-wrapper-rendered', 'layout-display-denied', 'layout-removal-applied']) {
            assert.equal(collect(['layout-reference-target-observed', type]).state, 'covered');
        }
        assert.throws(() => collect(['layout-block-rendered']), /Unexpected layout effect/);
        assert.throws(() => collect(['layout-argument-read']), /Argument read without native application evidence/);
        assert.equal(collect(['layout-argument-applied', 'layout-argument-read']).state, 'covered');
    }
});

test('layout action ambiguity remains visible and contributes zero hits', () => {
    const {manifest, record, sources} = fixture();
    const file = 'app/code/Acme/Blog/view/frontend/layout/blog_index_index.xml';
    const source = Buffer.from('<page><body><block name="blog"><action method="prepare"/></block></body></page>');
    const sourceHash = createHash('sha256').update(source).digest('hex');
    manifest.files.push({path: file, sourceHash, family: 'layout', declarations: [
        {id: 'action', family: 'layout', path: '/page/body/block/action', startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind: 'action', element: 'prepare', ordinal: 3,
                handle: 'blog_index_index', fileType: 'page', instruction: 'action'}}
    ]});
    manifest.layoutSources = {[file]: {hash: sourceHash, targets: {3: {ids: {action: 'action'}}}}};
    sources[file] = source;
    const action = {id: 'action', area: 'frontend', theme: 'frontend/Acme/theme', hits: 1};
    const ambiguous = merge(manifest, [{...record, layoutHook: true,
        events: [{...action, type: 'layout-action-ambiguous'}]}], sources);
    const declaration = ambiguous.files[1].declarations[0];
    assert.equal(declaration.hits, 0);
    assert.equal(declaration.state, 'unmeasured');
    assert.match(declaration.reason, /Multiple scheduled actions/);
    assert.equal(declaration.evidence[0].type, 'layout-action-ambiguous');
    const executed = merge(manifest, [{...record, layoutHook: true,
        events: [{...action, type: 'layout-action-executed'}]}], sources);
    assert.equal(executed.files[1].declarations[0].state, 'covered');
});

test('argument name operands require matching native value application in the same request and context', () => {
    for (const [bodyKind, nameKind, bodyType, nameType] of [
        ['argument', 'argument-name', 'layout-argument-applied', 'layout-argument-name-applied'],
        ['action-argument', 'action-argument-name', 'layout-action-argument-applied', 'layout-action-argument-name-applied'],
    ]) {
        const {manifest, record, sources} = fixture();
        const file = 'app/code/Acme/Blog/view/frontend/layout/names.xml';
        const source = Buffer.from('<layout><block name="subject"/></layout>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        manifest.files.push({path: file, sourceHash, family: 'layout', declarations: [bodyKind, nameKind].map((kind, index) => ({
            id: index ? 'name' : 'body', family: 'layout', path: '/layout/block/argument' + (index ? '/@name' : ''),
            startLine: 1, endLine: 1, supported: true, declaredScope: {type: 'frontend', code: ''},
            layout: {kind, element: 'value', ordinal: 1, handle: 'names', fileType: 'generic', instruction: 'argument'}
        }))});
        manifest.layoutSources = {[file]: {hash: sourceHash, targets: {1: {ids: {[bodyKind]: 'body', [nameKind]: 'name'}}}}};
        sources[file] = source;
        const event = (id, type) => ({id, type, area: 'frontend', theme: 'frontend/Acme/theme', hits: 1});
        const body = event('body', bodyType), name = event('name', nameType);
        const collect = events => merge(manifest, [{...record, layoutHook: true, events}], sources);
        assert.deepEqual(collect([]).files[1].declarations.map(item => item.state), ['uncovered', 'uncovered']);
        assert.throws(() => collect([name]), /Argument name application without matching native value evidence/);
        assert.throws(() => collect([body]), /Native value application without matching argument name evidence/);
        assert.throws(() => collect([body, {...name, theme: 'frontend/Acme/other'}]), /matching argument name evidence/);
        assert.throws(() => collect([body, {...name, hits: 2}]), /matching argument name evidence/);
        assert.deepEqual(collect([body, name]).files[1].declarations.map(item => [item.state, item.hits]), [['covered', 1], ['covered', 1]]);
        assert.deepEqual(collect([{...body, hits: 2}, {...name, hits: 2}]).files[1].declarations.map(item => item.hits), [2, 2]);
        assert.throws(() => collect([{...name, type: 'layout-argument-read'}, body]), /Unexpected layout effect/);
    }
});

test('layout structural and page-value reports require the correct native effect and retain zero-hit inventory', () => {
    const effects = {
        'action-method': 'layout-action-executed',
        block: 'layout-block-rendered',
        'block-class': 'layout-block-class-applied',
        'block-ttl': 'layout-block-ttl-applied',
        move: 'layout-move-detached',
        'move-element': 'layout-move-applied',
        'move-destination': 'layout-move-applied',
        'move-as': 'layout-move-alias-applied',
        'move-before': 'layout-move-order-applied',
        'move-after': 'layout-move-order-applied',
        container: 'layout-container-created',
        'container-htmlTag': 'layout-container-wrapper-rendered',
        'container-htmlId': 'layout-container-wrapper-rendered',
        'container-htmlClass': 'layout-container-wrapper-rendered',
        'container-display': 'layout-display-denied',
        'block-display': 'layout-display-allowed',
        'ui-placement': 'layout-ui-rendered',
        'page-attribute': 'layout-page-attribute-rendered',
        metadata: 'layout-metadata-rendered',
        'condition-ifconfig': 'layout-condition-allowed',
        'condition-aclResource': 'layout-condition-denied',
        'condition-acl': 'layout-condition-allowed',
        'asset-reference': 'layout-asset-reference-rendered',
        'asset-src': 'layout-asset-reference-rendered',
        'asset-src-type': 'layout-asset-reference-rendered',
        'asset-attribute-media': 'layout-asset-attribute-emitted',
        'asset-order': 'layout-asset-group-applied',
        'asset-condition': 'layout-asset-condition-rendered',
        'body-class': 'layout-body-class-rendered',
        'body-class-name': 'layout-body-classes-cleared',
        'body-class-value': 'layout-body-class-rendered',
        'file-override': 'layout-file-override-selected',
        'action-argument': 'layout-action-argument-applied',
        argument: 'layout-argument-read',
    };
    for (const [kind, type] of Object.entries(effects)) {
        const {manifest, record, sources} = fixture();
        const path = 'app/code/Acme/Blog/view/frontend/layout/fixture.xml';
        const source = Buffer.from('<page><body/></page>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        manifest.files.push({path, sourceHash, family: 'layout', declarations: [
            {id: 'effect', family: 'layout', path: '/page/body', startLine: 1, endLine: 1, supported: true,
                declaredScope: {type: 'frontend', code: ''}, layout: {kind, element: 'fixture', ordinal: 1,
                    handle: 'fixture', fileType: 'page', instruction: 'body'}}
        ]});
        manifest.layoutSources = {[path]: {hash: sourceHash, targets: {1: {ids: {[kind]: 'effect'}}}}};
        sources[path] = source;
        const empty = merge(manifest, [{...record, layoutHook: true}], sources);
        assert.equal(empty.files[1].declarations[0].state, 'uncovered', kind);
        const event = {id: 'effect', type, area: 'frontend', theme: 'frontend/Acme/theme', hits: 1};
        if (type === 'layout-argument-read') {
            assert.throws(() => merge(manifest, [{...record, layoutHook: true, events: [event]}], sources),
                /Argument read without native application evidence/);
        }
        const events = type === 'layout-argument-read' ? [{...event, type: 'layout-argument-applied'}, event] : [event];
        const covered = merge(manifest, [{...record, layoutHook: true, events}], sources);
        assert.equal(covered.files[1].declarations[0].state, 'covered', kind);
        const displaced = merge(manifest, [{...record, layoutHook: true,
            events: [{...event, type: 'layout-file-overridden'}]}], sources).files[1].declarations[0];
        assert.equal(displaced.state, 'unmeasured', kind);
        assert.equal(displaced.hits, 0, kind);
        if (kind === 'move' || kind.startsWith('move-')) {
            for (const type of ['layout-move-replaced', 'layout-move-overridden', 'layout-move-origin-unconfirmed']) {
                const item = merge(manifest, [{...record, layoutHook: true, events: [{...event, type}]}], sources).files[1].declarations[0];
                assert.equal(item.state, 'unmeasured', type);
                assert.equal(item.hits, 0, type);
                assert.equal(item.evidence[0].type, type);
            }
            const incorrect = kind === 'move-as' ? 'layout-move-order-applied' : 'layout-move-alias-applied';
            assert.throws(() => merge(manifest, [{...record, layoutHook: true,
                events: [{...event, type: incorrect}]}], sources), /Unexpected layout effect/, kind);
        }
        if (kind === 'block-class') {
            for (const type of ['layout-block-class-origin-unconfirmed', 'layout-block-class-storage-unconfirmed', 'layout-block-class-defaulted']) {
                const item = merge(manifest, [{...record, layoutHook: true, events: [{...event, type}]}], sources).files[1].declarations[0];
                assert.equal(item.state, 'unmeasured', type);
                assert.equal(item.hits, 0, type);
            }
        }
        if (kind === 'block-ttl') {
            const item = merge(manifest, [{...record, layoutHook: true,
                events: [{...event, type: 'layout-block-ttl-origin-unconfirmed'}]}], sources).files[1].declarations[0];
            assert.equal(item.state, 'unmeasured');
            assert.equal(item.hits, 0);
            assert.match(item.reason, /data storage/);
        }
        if (kind === 'block') {
            const item = merge(manifest, [{...record, layoutHook: true,
                events: [{...event, type: 'layout-block-cache-unconfirmed'}]}], sources).files[1].declarations[0];
            assert.equal(item.state, 'unmeasured');
            assert.equal(item.hits, 0);
            assert.match(item.reason, /original source of the cached bytes is unverified/);
        }
        if (kind === 'argument') {
            const item = merge(manifest, [{...record, layoutHook: true,
                events: [{...event, type: 'layout-argument-application-unconfirmed'}]}], sources).files[1].declarations[0];
            assert.equal(item.state, 'unmeasured');
            assert.equal(item.hits, 0);
            assert.match(item.reason, /later application lacks verified original ownership/);
            const read = {...event, type: 'layout-argument-storage-unconfirmed'};
            const unknownRead = merge(manifest, [{...record, layoutHook: true, events: [read]}], sources).files[1].declarations[0];
            assert.equal(unknownRead.state, 'unmeasured');
            assert.equal(unknownRead.hits, 0);
            assert.match(unknownRead.reason, /data property became hooked, unset, magic or subject to unverified lazy initialization/);
            const applied = merge(manifest, [{...record, layoutHook: true,
                events: [{...event, type: 'layout-argument-applied'}, read]}], sources).files[1].declarations[0];
            assert.equal(applied.state, 'covered');
            assert.equal(applied.hits, 1);
            assert.equal(applied.evidence.some(effect => effect.type === 'layout-argument-read'), false);
            assert.match(applied.reason, /later reads lack verified XML lineage/);
        }
        const unconfirmed = {...record, layoutHook: true, events: [{...event, type: 'layout-argument-origin-unconfirmed'}]};
        if (['argument', 'action-argument'].includes(kind)) {
            const item = merge(manifest, [unconfirmed], sources).files[1].declarations[0];
            assert.equal(item.state, 'unmeasured', kind);
            assert.equal(item.hits, 0, kind);
            assert.match(item.reason, /unverified implementation or intercepted method/, kind);
        } else {
            assert.throws(() => merge(manifest, [unconfirmed], sources), /Unexpected layout effect/, kind);
        }
        assert.throws(() => merge(manifest, [{...record, layoutHook: true,
            events: [{...event, type: ['argument', 'action-argument'].includes(kind) ? 'layout-move-applied' : 'layout-template-executed'}]}], sources), kind);
        assert.throws(() => merge(manifest, [{...record, layoutHook: true, run: 'stale', events: [event]}], sources), /Stale XML request/);
    }
});

test('template selection and an unconfirmed execution input retain independent evidence', () => {
    const {manifest, record, sources} = fixture();
    const path = 'app/code/Acme/Blog/view/frontend/layout/fixture.xml';
    const source = Buffer.from('<page><body/></page>');
    const sourceHash = createHash('sha256').update(source).digest('hex');
    manifest.files.push({path, sourceHash, family: 'layout', declarations: [
        {id: 'template', family: 'layout', path: '/page/body/block/@template', startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind: 'template', element: 'fixture', ordinal: 1,
                handle: 'fixture', fileType: 'page', instruction: 'block'}}
    ]});
    manifest.layoutSources = {[path]: {hash: sourceHash, targets: {1: {ids: {template: 'template'}}}}};
    sources[path] = source;
    const event = {id: 'template', type: 'layout-template-origin-unconfirmed', area: 'frontend', theme: 'frontend/Acme/theme', hits: 1};
    const unconfirmed = merge(manifest, [{...record, layoutHook: true, events: [event]}], sources).files[1].declarations[0];
    assert.equal(unconfirmed.state, 'unmeasured');
    assert.equal(unconfirmed.hits, 0);
    assert.match(unconfirmed.reason, /unverified template getter, filename resolver or PHP template engine/);
    const selected = merge(manifest, [{...record, layoutHook: true,
        events: [{...event, type: 'layout-template-selected'}, event]}], sources).files[1].declarations[0];
    assert.equal(selected.state, 'unmeasured');
    assert.equal(selected.hits, 0);
    assert.ok(selected.evidence.some(event => event.type === 'layout-template-origin-unconfirmed'));
    const rejected = merge(manifest, [{...record, layoutHook: true,
        events: [{...event, type: 'layout-template-selected'}, {...event, type: 'layout-template-validation-rejected'}]}], sources).files[1].declarations[0];
    assert.equal(rejected.state, 'unmeasured');
    assert.equal(rejected.hits, 0);
    assert.match(rejected.reason, /native template file validator rejected/);
    assert.equal(rejected.evidence.length, 2);
    const cached = merge(manifest, [{...record, layoutHook: true,
        events: [{...event, type: 'layout-template-cache-unconfirmed'}]}], sources).files[1].declarations[0];
    assert.equal(cached.state, 'unmeasured');
    assert.equal(cached.hits, 0);
    assert.match(cached.reason, /Cached block HTML bypassed this selected template/);
});

test('shared objects and unverified registrations cannot turn construction into layout render evidence', () => {
    const {manifest, record, sources} = fixture();
    const path = 'app/code/Acme/Blog/view/frontend/layout/fixture.xml';
    const source = Buffer.from('<layout><block name="fixture"/></layout>');
    const sourceHash = createHash('sha256').update(source).digest('hex');
    manifest.files.push({path, sourceHash, family: 'layout', declarations: [
        {id: 'block', family: 'layout', path: '/layout/block', startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind: 'block', element: 'fixture', ordinal: 1,
                handle: 'fixture', fileType: 'generic', instruction: 'block'}}
    ]});
    manifest.layoutSources = {[path]: {hash: sourceHash, targets: {1: {ids: {block: 'block'}}}}};
    sources[path] = source;
    for (const type of ['layout-block-render-origin-unconfirmed', 'layout-block-registration-origin-unconfirmed']) {
        const uncertain = {id: 'block', type, area: 'frontend', theme: 'frontend/Acme/theme', hits: 4};
        const empty = merge(manifest, [{...record, layoutHook: true, events: [uncertain]}], sources).files[1].declarations[0];
        assert.equal(empty.hits, 0);
        assert.equal(empty.state, 'unmeasured');
        const created = merge(manifest, [{...record, layoutHook: true,
            events: [{...uncertain, type: 'layout-block-created', hits: 1}, uncertain]}], sources).files[1].declarations[0];
        assert.equal(created.hits, 0);
        assert.equal(created.state, 'unmeasured');
        assert.deepEqual(created.evidence.map(event => event.type), ['layout-block-created', type]);
        assert.equal(created.evidence.some(event => event.type === 'layout-block-rendered'), false);
    }
});

test('native file selection remains a zero-hit observation and cannot substitute for effect hook health', () => {
    const {manifest, record, sources} = fixture();
    const file = 'app/code/Acme/Blog/view/frontend/layout/empty.xml';
    const source = Buffer.from('<page/>');
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const item = {id: 'file-selected', family: 'layout', path: '/page', node: '/page', startLine: 1, endLine: 1,
        supported: false, reason: 'Merged input observation', declaredScope: {type: 'frontend', code: ''},
        layout: {kind: 'file-selection', element: '', ordinal: 0, handle: 'empty', fileType: 'page', instruction: 'page'}};
    manifest.files.push({path: file, sourceHash, family: 'layout', declarations: [item]});
    manifest.layoutSources = {[file]: {hash: sourceHash, targets: {0: {ids: {'file-selection': item.id}}}}};
    sources[file] = source;
    const event = {id: item.id, type: 'layout-file-selected', hits: 4, area: 'frontend', theme: 'frontend/Acme/theme'};
    const request = {...record, layoutHook: false, events: [event]};
    const result = merge(manifest, [request], sources);
    assert.deepEqual(result.layout, {total: 0, covered: 0, hook: false, limitations: []});
    assert.equal(result.files[1].declarations[0].hits, 0);
    assert.equal(result.files[1].declarations[0].state, 'unmeasured');
    assert.deepEqual(result.files[1].declarations[0].evidence.map(item => item.type), ['layout-file-selected']);
    assert.throws(() => merge(manifest, [{...request, events: [{...event, type: 'layout-block-created'}]}], sources),
        /Unexpected layout effect/);
    manifest.files[1].declarations.push({...item, id: 'block', supported: true,
        layout: {...item.layout, kind: 'block', ordinal: 1, instruction: 'block'}});
    assert.throws(() => merge(manifest, [request], sources), /No functioning XML layout hook/);
});

test('cache and opaque file-list observations preserve a functioning zero-hit layout inventory', () => {
    const {manifest, record, sources} = fixture();
    const path = 'app/code/Acme/Blog/view/frontend/layout/fixture.xml';
    const source = Buffer.from('<layout><container name="fixture"/></layout>');
    const sourceHash = createHash('sha256').update(source).digest('hex');
    manifest.files.push({path, sourceHash, family: 'layout', declarations: [
        {id: 'container', family: 'layout', path: '/layout/container', startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind: 'container', element: 'fixture', ordinal: 1,
                handle: 'fixture', fileType: 'generic', instruction: 'container'}}
    ]});
    manifest.layoutSources = {[path]: {hash: sourceHash, targets: {1: {ids: {container: 'container'}}}}};
    sources[path] = source;
    const warm = {...record, layoutHook: true, layoutSourceTrace: false, events: [],
        layoutLimitations: ['full-page-cache-origin']};
    const report = merge(manifest, [warm], sources);
    assert.equal(report.layout.covered, 0);
    assert.equal(report.files[1].declarations[0].state, 'uncovered');
    assert.deepEqual(report.files[1].declarations[0].evidence, []);
    assert.match(report.layout.limitations[0], /native full-page cache lookup returned a response/);
    assert.deepEqual(report.requests[0].events, []);
    assert.deepEqual(report.requests[0].layoutLimitations, report.layout.limitations);
    const command = {...warm, tool: 'magento'};
    const fromWorkers = merge(manifest, [
        command,
        {...command, events: record.events, layoutLimitations: ['scheduled-layout-cache']},
        command,
    ], sources);
    assert.equal(fromWorkers.requests.length, 1);
    assert.equal(fromWorkers.requests[0].tool, 'magento');
    assert.deepEqual(fromWorkers.requests[0].events, record.events);
    assert.deepEqual(fromWorkers.requests[0].layoutLimitations, [...fromWorkers.layout.limitations].sort());
    assert.equal(fromWorkers.requests[0].layoutLimitations.length, 2);
    assert.equal(fromWorkers.layout.covered, 0);
    const fileList = merge(manifest, [{...warm, layoutLimitations: ['layout-file-replacement-storage-unconfirmed']}], sources);
    assert.equal(fileList.layout.covered, 0);
    assert.equal(fileList.files[1].declarations.length, 1);
    assert.equal(fileList.files[1].declarations[0].state, 'unmeasured');
    assert.deepEqual(fileList.files[1].declarations[0].evidence, []);
    assert.match(fileList.layout.limitations[0], /file-list backing storage/);
    assert.deepEqual(fileList.requests[0].layoutLimitations, fileList.layout.limitations);
    const descriptor = merge(manifest, [{...warm, layoutLimitations: ['layout-file-replacement-descriptor-unconfirmed']}], sources);
    assert.equal(descriptor.layout.covered, 0);
    assert.equal(descriptor.files[1].declarations.length, 1);
    assert.deepEqual(descriptor.files[1].declarations[0].evidence, []);
    assert.match(descriptor.layout.limitations[0], /file descriptor/);
    assert.deepEqual(descriptor.requests[0].layoutLimitations, descriptor.layout.limitations);
    const opaque = merge(manifest, [{...warm, layoutLimitations: ['layout-opaque-action-data']}], sources);
    assert.equal(opaque.layout.covered, 0);
    assert.equal(opaque.files[1].declarations.length, 1);
    assert.equal(opaque.files[1].declarations[0].state, 'unmeasured');
    assert.deepEqual(opaque.files[1].declarations[0].evidence, []);
    assert.match(opaque.layout.limitations[0], /could execute application serialization/);
    assert.deepEqual(opaque.requests[0].layoutLimitations, opaque.layout.limitations);
    assert.throws(() => merge(manifest, [{...warm, layoutHook: false}], sources), /No functioning XML layout hook/);
});

test('empty layout operands remain zero-hit decisions while zero class interpolation records output', () => {
    for (const [kind, type, covered] of [
        ['position-name', 'layout-position-name-defaulted', false],
        ['template', 'layout-template-empty-ignored', false],
        ['block-group', 'layout-block-group-empty-ignored', false],
        ['block-ttl', 'layout-block-ttl-empty-ignored', false],
        ['block-display', 'layout-display-empty-ignored', false],
        ['removal', 'layout-removal-empty-ignored', false],
        ['container-htmlClass', 'layout-container-wrapper-zero-class-emitted', true],
    ]) {
        const {manifest, record, sources} = fixture();
        const path = 'app/code/Acme/Blog/view/frontend/layout/empty.xml';
        const source = Buffer.from('<layout/>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        sources[path] = source;
        manifest.files.push({path, sourceHash, family: 'layout', declarations: [
            {id: 'operand', family: 'layout', path: '/layout/block/@field', startLine: 1, endLine: 1, supported: true,
                declaredScope: {type: 'frontend', code: ''}, layout: {kind, ordinal: 1, element: 'fixture',
                    handle: 'empty', fileType: 'generic', instruction: 'block'}}]});
        manifest.layoutSources = {[path]: {hash: sourceHash, targets: {1: {ids: {[kind]: 'operand'}}}}};
        const healthy = {...record, layoutHook: true};
        assert.equal(merge(manifest, [healthy], sources).files[1].declarations[0].state, 'uncovered');
        const event = {id: 'operand', type, hits: 1, area: 'frontend', theme: 'frontend/Acme/theme'};
        const item = merge(manifest, [{...healthy, events: [event]}], sources).files[1].declarations[0];
        assert.equal(item.state, covered ? 'covered' : 'unmeasured');
        assert.equal(item.hits, covered ? 1 : 0);
        if (!covered) assert.match(item.reason, /empty|zero|0/);
        manifest.files[1].declarations[0].layout.kind = 'block';
        assert.throws(() => merge(manifest, [{...healthy, events: [event]}], sources), /Unexpected layout effect/);
    }
});

test('argument group selection and ignored descendants retain separate native outcomes', () => {
    for (const kind of ['argument-group', 'argument', 'argument-name', 'argument-type', 'argument-updater']) {
        const {manifest, record, sources} = fixture();
        const path = 'app/code/Acme/Blog/view/frontend/layout/groups.xml';
        const source = Buffer.from('<layout/>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        sources[path] = source;
        manifest.files.push({path, sourceHash, family: 'layout', declarations: [{id: 'group-field', family: 'layout',
            path: '/layout/block/arguments', startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind, ordinal: 2, element: 'value',
                handle: 'groups', fileType: 'generic', instruction: 'arguments'}}]});
        manifest.layoutSources = {[path]: {hash: sourceHash, targets: {2: {ids: {[kind]: 'group-field'}}}}};
        const event = type => ({id: 'group-field', type, hits: 1, area: 'frontend', theme: 'frontend/Acme/theme'});
        const ignored = merge(manifest, [{...record, layoutHook: true, events: [event('layout-argument-group-ignored')]}], sources).files[1].declarations[0];
        assert.equal(ignored.hits, 0);
        assert.equal(ignored.state, 'unmeasured');
        const selected = event('layout-argument-group-selected');
        if (kind !== 'argument-group') {
            assert.throws(() => merge(manifest, [{...record, layoutHook: true, events: [selected]}], sources), /Unexpected layout effect/);
            continue;
        }
        assert.equal(merge(manifest, [{...record, layoutHook: true, events: [selected]}], sources).files[1].declarations[0].hits, 1);
        for (const type of ['layout-argument-group-failed', 'layout-argument-group-origin-unconfirmed']) {
            assert.equal(merge(manifest, [{...record, layoutHook: true, events: [event(type)]}], sources).files[1].declarations[0].hits, 0);
        }
        assert.throws(() => merge(manifest, [{...record, events: [selected]}], sources), /layout.*hook/i);
        assert.throws(() => merge(manifest, [{...record, layoutHook: true, events: [event('layout-argument-applied')]}], sources), /Unexpected layout effect/);
    }
});

test('layout argument type operands require their own native dispatch evidence', () => {
    for (const instruction of ['argument', 'item']) {
        const {manifest, record, sources} = fixture();
        const path = 'app/code/Acme/Blog/view/frontend/layout/types.xml';
        const source = Buffer.from('<layout/>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        sources[path] = source;
        manifest.files.push({path, sourceHash, family: 'layout', declarations: [{id: 'type-field', family: 'layout',
            path: '/layout/block/arguments/argument' + (instruction === 'item' ? '/item' : '') + '/@xsi:type', startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind: 'argument-type', ordinal: 2, element: 'value',
                handle: 'types', fileType: 'generic', instruction, attribute: 'xsi:type'}}]});
        manifest.layoutSources = {[path]: {hash: sourceHash, targets: {2: {ids: {'argument-type': 'type-field'}}}}};
        const event = type => ({id: 'type-field', type, hits: 1, area: 'frontend', theme: 'frontend/Acme/theme'});
        for (const type of ['layout-argument-type-deferred', 'layout-argument-type-failed', 'layout-argument-type-origin-unconfirmed', 'layout-argument-type-ambiguous']) {
            const item = merge(manifest, [{...record, layoutHook: true, events: [event(type)]}], sources).files[1].declarations[0];
            assert.equal(item.hits, 0, type);
            assert.equal(item.state, 'unmeasured', type);
        }
        const evaluated = event('layout-argument-type-evaluated');
        const item = merge(manifest, [{...record, layoutHook: true, events: [evaluated]}], sources).files[1].declarations[0];
        assert.equal(item.hits, 1);
        assert.equal(item.state, 'covered');
        assert.throws(() => merge(manifest, [{...record, layoutHook: true, events: [event('layout-argument-applied')]}], sources), /Unexpected layout effect/);
        assert.throws(() => merge(manifest, [{...record, events: [evaluated]}], sources), /layout.*hook/i);
        assert.throws(() => merge(manifest, [{...record, layoutHook: true, run: 'stale', events: [evaluated]}], sources), /Stale XML request/);
        assert.throws(() => merge(manifest, [{...record, layoutHook: true, events: [{...evaluated, id: 'unknown'}]}], sources), /Unknown or unmeasured XML evidence/);
    }
});

test('argument modifier facts require an original operand and their own completed native consumer', () => {
    for (const attribute of ['translate', 'shared', 'model', 'helper', 'path']) {
        const {manifest, record, sources} = fixture();
        const path = 'app/code/Acme/Blog/view/frontend/layout/modifiers.xml';
        const source = Buffer.from('<layout/>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        const kind = 'argument-' + attribute;
        sources[path] = source;
        manifest.files.push({path, sourceHash, family: 'layout', declarations: [{id: 'modifier', family: 'layout',
            path: '/layout/block/arguments/argument/@' + attribute, startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind, ordinal: 2, element: 'value',
                handle: 'modifiers', fileType: 'generic', instruction: 'argument', attribute}}]});
        manifest.layoutSources = {[path]: {hash: sourceHash, targets: {2: {ids: {[kind]: 'modifier'}}}}};
        const event = type => ({id: 'modifier', type, hits: 1, area: 'frontend', theme: 'frontend/Acme/theme'});
        for (const type of ['layout-argument-modifier-deferred', 'layout-argument-modifier-failed', 'layout-argument-modifier-origin-unconfirmed', 'layout-argument-modifier-ambiguous']) {
            const item = merge(manifest, [{...record, layoutHook: true, events: [event(type)]}], sources).files[1].declarations[0];
            assert.equal(item.hits, 0, type);
            assert.equal(item.state, 'unmeasured', type);
        }
        const evaluated = event('layout-argument-modifier-evaluated');
        assert.equal(merge(manifest, [{...record, layoutHook: true, events: [evaluated]}], sources).files[1].declarations[0].hits, 1);
        assert.throws(() => merge(manifest, [{...record, events: [evaluated]}], sources), /layout.*hook/i);
        assert.throws(() => merge(manifest, [{...record, layoutHook: true, events: [event('layout-argument-applied')]}], sources), /Unexpected layout effect/);
        assert.throws(() => merge(manifest, [{...record, layoutHook: true, run: 'stale', events: [evaluated]}], sources), /Stale XML request/);
    }
});

test('unobserved template field access cannot infer XML execution or erase earlier value application', () => {
    for (const kind of ['template', 'argument', 'action-argument']) {
        const {manifest, record, sources} = fixture();
        const path = 'app/code/Acme/Blog/view/frontend/layout/direct.xml';
        const source = Buffer.from('<layout/>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        sources[path] = source;
        manifest.files.push({path, sourceHash, family: 'layout', declarations: [{id: 'direct', family: 'layout',
            path: '/layout/block/@template', startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind, ordinal: 2, element: 'template',
                handle: 'direct', fileType: 'generic', instruction: 'block'}}]});
        manifest.layoutSources = {[path]: {hash: sourceHash, targets: {2: {ids: {[kind]: 'direct'}}}}};
        const event = type => ({id: 'direct', type, hits: 1, area: 'frontend', theme: 'frontend/Acme/theme'});
        const uncertain = event('layout-template-field-access-unconfirmed');
        const limited = merge(manifest, [{...record, layoutHook: true, events: [uncertain]}], sources).files[1].declarations[0];
        assert.equal(limited.hits, 0);
        assert.equal(limited.state, 'unmeasured');
        assert.match(limited.reason, /outside the observed native accessors/);
        assert.throws(() => merge(manifest, [{...record, events: [uncertain]}], sources), /layout.*hook/i);
        if (kind !== 'template') {
            const applied = event(kind === 'argument' ? 'layout-argument-applied' : 'layout-action-argument-applied');
            const retained = merge(manifest, [{...record, layoutHook: true, events: [applied, uncertain]}], sources).files[1].declarations[0];
            assert.equal(retained.hits, 1);
            assert.equal(retained.state, 'covered');
        }
    }
});

test('unobserved block data field access preserves application and cannot grant value-read coverage', () => {
    const {manifest, record, sources} = fixture();
    const path = 'app/code/Acme/Blog/view/frontend/layout/data.xml';
    const source = Buffer.from('<layout/>');
    const sourceHash = createHash('sha256').update(source).digest('hex');
    sources[path] = source;
    manifest.files.push({path, sourceHash, family: 'layout', declarations: [{id: 'data', family: 'layout',
        path: '/layout/block/arguments/argument', startLine: 1, endLine: 1, supported: true,
        declaredScope: {type: 'frontend', code: ''}, layout: {kind: 'argument', ordinal: 2, element: 'value',
            handle: 'data', fileType: 'generic', instruction: 'argument'}}]});
    manifest.layoutSources = {[path]: {hash: sourceHash, targets: {2: {ids: {argument: 'data'}}}}};
    const event = type => ({id: 'data', type, hits: 1, area: 'frontend', theme: 'frontend/Acme/theme'});
    const uncertain = event('layout-argument-field-access-unconfirmed');
    const request = {...record, layoutHook: true, events: [uncertain]};
    const limited = merge(manifest, [request], sources).files[1].declarations[0];
    assert.equal(limited.hits, 0);
    assert.equal(limited.state, 'unmeasured');
    assert.match(limited.reason, /outside the observed native data accessors/);
    const applied = merge(manifest, [{...request, events: [event('layout-argument-applied'), uncertain]}], sources).files[1].declarations[0];
    assert.equal(applied.hits, 1);
    assert.equal(applied.state, 'covered');
    assert.equal(applied.evidence.some(item => item.type === 'layout-argument-read'), false);
    assert.throws(() => merge(manifest, [{...request, layoutHook: false}], sources), /layout.*hook/i);
    assert.throws(() => merge(manifest, [{...request, events: [{...uncertain, id: 'unknown'}]}], sources), /Unknown or unmeasured XML evidence/);
});

test('template-valued XML arguments retain selection and execution as independent facts', () => {
    for (const kind of ['argument', 'action-argument']) {
        const {manifest, record, sources} = fixture();
        const path = 'app/code/Acme/Blog/view/frontend/layout/template.xml';
        const source = Buffer.from('<layout/>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        sources[path] = source;
        manifest.files.push({path, sourceHash, family: 'layout', declarations: [{id: 'filename', family: 'layout',
            path: '/layout/block/arguments/argument', startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind, ordinal: 2, element: 'block',
                handle: 'template', fileType: 'generic', instruction: 'argument'}}]});
        manifest.layoutSources = {[path]: {hash: sourceHash, targets: {2: {ids: {[kind]: 'filename'}}}}};
        const event = type => ({id: 'filename', type, hits: 1, area: 'frontend', theme: 'frontend/Acme/theme'});
        const selected = event('layout-template-selected');
        assert.throws(() => merge(manifest, [{...record, layoutHook: true, events: [event('layout-template-empty-ignored')]}], sources), /Unexpected layout effect/);
        const observed = merge(manifest, [{...record, layoutHook: true, events: [selected]}], sources).files[1].declarations[0];
        assert.equal(observed.hits, 0);
        for (const type of ['layout-template-overridden', 'layout-template-replaced', 'layout-template-failed']) {
            const replaced = merge(manifest, [{...record, layoutHook: true, events: [selected, event(type)]}], sources).files[1].declarations[0];
            assert.equal(replaced.hits, 0);
            assert.equal(replaced.state, 'unmeasured');
        }
        const executed = merge(manifest, [{...record, layoutHook: true, events: [selected, event('layout-template-executed')]}], sources).files[1].declarations[0];
        assert.equal(executed.hits, 1);
        assert.equal(executed.state, 'covered');
    }
});

test('failed action boundaries retain zero call hits and independent argument evaluation', () => {
    for (const [kind, type, covered] of [
        ['action', 'layout-action-completion-failed', false],
        ['action-method', 'layout-action-evaluation-failed', false],
        ['action-argument', 'layout-action-argument-evaluated', true],
        ['action-argument-name', 'layout-action-argument-name-evaluated', true],
        ['action-argument', 'layout-action-argument-evaluation-incomplete', false],
        ['action-argument-name', 'layout-action-argument-name-evaluation-incomplete', false],
    ]) {
        const {manifest, record, sources} = fixture();
        const path = 'app/code/Acme/Blog/view/frontend/layout/failure.xml';
        const source = Buffer.from('<layout/>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        sources[path] = source;
        manifest.files.push({path, sourceHash, family: 'layout', declarations: [{id: 'failed', family: 'layout',
            path: '/layout/block/action', startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind, ordinal: 2, element: 'observe',
                handle: 'failure', fileType: 'generic', instruction: 'action'}}]});
        manifest.layoutSources = {[path]: {hash: sourceHash, targets: {2: {ids: {[kind]: 'failed'}}}}};
        const event = {id: 'failed', type, hits: 4, area: 'frontend', theme: 'frontend/Acme/theme'};
        const item = merge(manifest, [{...record, layoutHook: true, events: [event]}], sources).files[1].declarations[0];
        assert.equal(item.hits > 0, covered);
        assert.equal(item.state, covered ? 'covered' : 'unmeasured');
        if (!covered) assert.match(item.reason, /evaluat|dispatch|body|call/i);
    }
});

test('unverified native action snapshots retain zero-hit original call operands', () => {
    for (const kind of ['action', 'action-method']) {
        const {manifest, record, sources} = fixture();
        const path = 'app/code/Acme/Blog/view/frontend/layout/action.xml';
        const source = Buffer.from('<layout/>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        sources[path] = source;
        manifest.files.push({path, sourceHash, family: 'layout', declarations: [{id: 'call', family: 'layout',
            path: '/layout/block/action', startLine: 1, endLine: 1, supported: true,
            declaredScope: {type: 'frontend', code: ''}, layout: {kind, ordinal: 2, element: 'mark',
                handle: 'action', fileType: 'generic', instruction: 'action'}}]});
        manifest.layoutSources = {[path]: {hash: sourceHash, targets: {2: {ids: {[kind]: 'call'}}}}};
        const event = {id: 'call', type: 'layout-action-origin-unconfirmed', hits: 4, area: 'frontend', theme: 'frontend/Acme/theme'};
        const item = merge(manifest, [{...record, layoutHook: true, events: [event]}], sources).files[1].declarations[0];
        assert.equal(item.hits, 0);
        assert.equal(item.state, 'unmeasured');
        assert.match(item.reason, /snapshot|source|origin/i);
    }
});

test('native action scope decisions remain independent of action calls and skipped guards', () => {
    for (const effect of ['allowed', 'denied', 'ambiguous', 'empty-ignored', 'unobserved', 'origin-unconfirmed', 'failed']) {
        const {manifest, record, sources} = fixture();
        const path = 'app/code/Acme/Blog/view/frontend/layout/guards.xml';
        const source = Buffer.from('<layout/>');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        sources[path] = source;
        manifest.files.push({path, sourceHash, family: 'layout', declarations: [
            {id: 'guard', family: 'layout', path: '/layout/block/action/@ifconfig', startLine: 1, endLine: 1,
                supported: true, declaredScope: {type: 'frontend', code: ''}, layout: {kind: 'action-ifconfig',
                    ordinal: 2, element: 'mark', handle: 'guards', fileType: 'generic', instruction: 'action'}}]});
        manifest.layoutSources = {[path]: {hash: sourceHash, targets: {2: {ids: {'action-ifconfig': 'guard'}}}}};
        const healthy = {...record, layoutHook: true};
        assert.equal(merge(manifest, [healthy], sources).files[1].declarations[0].state, 'uncovered');
        const unselected = merge(manifest, [{...healthy, layoutSourceTrace: false,
            layoutLimitations: ['missing-layout-origins'], events: []}], sources);
        assert.equal(unselected.files[1].declarations[0].state, 'unmeasured');
        assert.equal(unselected.files[1].declarations[0].hits, 0);
        assert.deepEqual(unselected.files[1].declarations[0].evidence, []);

        const event = {id: 'guard', type: `layout-action-condition-${effect}`, hits: 2,
            area: 'frontend', theme: 'frontend/Acme/theme'};
        const item = merge(manifest, [{...healthy, events: [event]}], sources).files[1].declarations[0];
        const covered = ['allowed', 'denied'].includes(effect);
        assert.equal(item.state, covered ? 'covered' : 'unmeasured');
        assert.equal(item.hits, covered ? 2 : 0);
        manifest.files[1].declarations[0].layout.kind = 'action';
        assert.throws(() => merge(manifest, [{...healthy, events: [event]}], sources), /Unexpected layout effect/);
    }
});
function familyFixture() {
    const {manifest, record, sources} = fixture();
    const file = 'app/code/Acme/Blog/etc/crontab.xml';
    const source = Buffer.from('<config>\n<job name="observed"/>\n<job name="untouched"/>\n<job name="shadowed"/>\n</config>');
    const id = name => createHash('sha256').update(name).digest('hex');
    const effects = ['cron-schedule-evaluated', 'cron-handler-entered', 'cron-handler-completed'];
    sources[file] = source;
    manifest.files.push({path: file, family: 'cron', sourceHash: id(source),
        declarations: ['observed', 'untouched', 'shadowed'].map((name, index) => ({
            id: id(name), family: 'cron', path: name, supported: true, effective: true, effects,
            declaredScope: {type: 'source', code: ''}, startLine: 2 + index, endLine: 2 + index
        }))
    });
    const event = (name, type, outcome, reason = null) => ({
        id: id(name), type, outcome, reason, area: 'crontab', hits: 1
    });
    record.events.push(
        event('observed', effects[0], 'cache-only', 'Schedule was read from the cache'),
        event('observed', effects[1], 'entered'),
        event('observed', effects[2], 'failed'),
        event('shadowed', effects[1], 'displaced', 'Another module supplied the handler')
    );
    return {manifest, record, sources, file};
}

test('XML family effects distinguish observations, failed completion and uncertain provenance', t => {
    const {manifest, record, sources, file} = familyFixture();
    const result = merge(manifest, [record], sources);
    const [observed, untouched, shadowed] = result.files.find(entry => entry.path === file).declarations;
    assert.deepEqual([observed.state, untouched.state, shadowed.state], ['covered', 'uncovered', 'uncovered']);
    assert.equal(observed.hits, 1);
    assert.deepEqual(observed.effectStates, {
        'cron-schedule-evaluated': 'uncovered',
        'cron-handler-entered': 'covered',
        'cron-handler-completed': 'uncovered'
    });
    assert.deepEqual(observed.evidence.map(event => [event.outcome, event.reason]), [
        ['cache-only', 'Schedule was read from the cache'], ['entered', null], ['failed', null]
    ]);
    assert.equal(observed.evidence[0].request, record.request);
    assert.equal(observed.evidence[0].run, record.run);
    assert.ok(result.warnings.some(warning => warning.declaration === shadowed.id && warning.reason === 'Another module supplied the handler'));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-family-report-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    writeReport(result, sources, directory);
    const html = fs.readFileSync(path.join(directory, file + '.html'), 'utf8');
    assert.match(html, /cron-handler-completed.*uncovered.*crontab.*failed/s);
    assert.match(html, /cron-handler-entered.*uncovered.*displaced.*Another module supplied the handler/s);
});

test('XML family evidence rejects undeclared effects, malformed outcomes and extra data', () => {
    const {manifest, record, sources} = familyFixture();
    for (const patch of [{type: 'webapi-match'}, {outcome: 'true'}, {reason: null}, {payload: 'private'}]) {
        const incorrect = {...record, events: [record.events[0], {...record.events[1], ...patch}]};
        assert.throws(() => merge(manifest, [incorrect], sources));
    }
});

test('browser XML effects require delivery from the same active HTTP response', () => {
    const {manifest, record, sources} = fixture();
    const file = 'app/code/Acme/Blog/view/adminhtml/ui_component/screen.xml';
    const id = '1'.repeat(64), request = '2'.repeat(32), identity = 'screen.screen.field';
    sources[file] = Buffer.from('<listing>\n<field name="field"/>\n</listing>');
    manifest.files.push({path: file, family: 'ui-component', sourceHash: createHash('sha256').update(sources[file]).digest('hex'),
        declarations: [{id, family: 'ui-component', path: identity, effects: ['ui-delivered', 'ui-constructed', 'ui-rendered'],
            supported: true, effective: true, declaredScope: {type: 'adminhtml', code: ''}, startLine: 2, endLine: 2}]
    });
    const delivery = {id, type: 'ui-delivered', area: 'adminhtml', outcome: 'observed', reason: null, hits: 1};
    const browser = {run: record.run, response: request, identity, type: 'ui-rendered'};
    const native = {...record, request, status: 200, events: [delivery]};
    const result = merge(manifest, [record, native], sources, [browser]);
    const [declaration] = result.files.find(entry => entry.path === file).declarations;
    assert.deepEqual(declaration.effectStates, {'ui-delivered': 'covered', 'ui-constructed': 'uncovered', 'ui-rendered': 'covered'});
    assert.equal(declaration.evidence[1].request, request);
    assert.equal(declaration.evidence[1].origin, 'browser');
    assert.throws(() => merge(manifest, [record, {...native, events: []}], sources, [browser]), /delivery/i);
    assert.throws(() => merge(manifest, [record, native], sources, [{...browser, run: 'stale'}]), /stale/i);
    assert.throws(() => merge(manifest, [record, native], sources, [{...browser, identity: 'another.field'}]), /delivery/i);
    assert.throws(() => merge(manifest, [record, native], sources, [{...browser, values: {customer: 'private'}}]), /browser XML/i);
});
