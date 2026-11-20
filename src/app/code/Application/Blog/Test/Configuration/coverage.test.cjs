// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Verifies real current-run request evidence after both browser runners exercise
// the disposable Blog fixture. Missing artifacts fail; no skips or fabricated hits.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const directory = process.env.MAGELENS_XML_ACCEPTANCE_DIR || 'coverage';
const read = file => JSON.parse(fs.readFileSync(path.join(directory, file)));
const config = 'app/code/Application/Blog/etc/config.xml';
const system = 'app/code/Application/Blog/etc/adminhtml/system.xml';
const layoutFixtureDi = 'app/code/MageLens/Compatibility/etc/frontend/di.xml';
const cacheDispatchSubject = 'Magento\\PageCache\\Model\\App\\FrontController\\BuiltinPlugin';
const cachePluginName = 'magelens_layout_cache_fixture';
const prefix = 'application_blog/display/';
function report() {
    const value = read('xml/coverage.json');
    assert.equal(value.run, read('run.json').id);
    assert.equal(value.complete, true);
    assert.equal(value.sourcesUnchanged, true);
    assert.deepEqual(value.collectorErrors, []);
    return value;
}
function declaration(result, file, key, type = 'default', code = '', family = null) {
    const matches = result.files.find(entry => entry.path === file)?.declarations
        .filter(item => item.path === key && item.declaredScope.type === type && item.declaredScope.code === code
            && (!family || item.family === family));
    assert.equal(matches?.length, 1, `${key} at ${type}/${code}`);
    return matches[0];
}
function request(result, name) {
    const requests = result.requests.filter(entry => entry.case === name);
    assert.equal(requests.length, 1, `Expected exactly one real request for ${name}`);
    const [record] = requests;
    const bridge = declaration(result, layoutFixtureDi, `${cacheDispatchSubject}/${cachePluginName}`, 'frontend', '', 'plugins');
    const [dispatch, ...events] = record.events;
    // The cache fixture's native frontend dispatch runs before the Blog probe.
    assert.deepEqual(dispatch, {
        id: bridge.id, type: 'plugin-execute', area: 'frontend', name: cachePluginName,
        callback: {subject: cacheDispatchSubject, method: 'aroundDispatch', phase: 'before'}, hits: 1,
    }, name);
    return {...record, events};
}
test('reports original XML bytes and nested directory/source HTML with no structural credit', () => {
    const result = report();
    assert.match(fs.readFileSync(path.join(directory, 'index.html'), 'utf8'), /href=["']xml\/index.html["']/);
    for (const filePath of [config, system]) {
        const file = result.files.find(entry => entry.path === filePath);
        const original = fs.readFileSync(path.join(__dirname, 'fixtures', filePath.slice('app/code/Application/Blog/'.length)));
        assert.equal(file.sourceHash, createHash('sha256').update(original).digest('hex'));
        assert.match(fs.readFileSync(path.join(directory, 'xml', filePath + '.html'), 'utf8'), /class="line (covered|uncovered)"/);
        for (let parent = path.posix.dirname(filePath); parent !== '.'; parent = path.posix.dirname(parent)) {
            assert.match(fs.readFileSync(path.join(directory, 'xml', parent, 'index.html'), 'utf8'), /<html/i);
        }
        for (const [index] of original.toString().split('\n').entries()) {
            if (!file.declarations.some(item => index + 1 >= item.startLine && index + 1 <= item.endLine)) {
                assert.equal(file.lines[index + 1]?.state || 'neutral', 'neutral');
            }
        }
    }
});
test('baseline and warm-up cannot credit unread XML', () => {
    const result = report();
    assert.deepEqual(request(result, 'baseline').events, []);
    assert.ok(!result.requests.some(entry => entry.case === 'warmup-only'));
    assert.equal(declaration(result, config, prefix + 'unused').state, 'uncovered');
});
const scopeCases = [
    ['default-read', 'default', '', 'default', ''],
    ['website-read', 'websites', 'journal_website', 'websites', 'journal_website'],
    ['store-read', 'stores', 'journal_store', 'stores', 'journal_store'],
    ['store-inherits-website', 'websites', 'journal_website', 'stores', 'journal_inherited_store'],
    ['store-inherits-default', 'default', '', 'stores', 'journal_other_store'],
    ['website-inherits-default', 'default', '', 'websites', 'journal_other_website']
];
for (const [name, declaredType, declaredCode, requestedType, requestedCode] of scopeCases) {
    test(`${name}: attribute only the effective source and retain requested scope`, () => {
        const result = report();
        const winner = declaration(result, config, prefix + 'heading', declaredType, declaredCode);
        const events = request(result, name).events;
        assert.ok(events.length > 0);
        assert.ok(events.every(event => event.id === winner.id && event.type === 'config-read'));
        assert.ok(events.every(event => event.requestedScope.type === requestedType && event.requestedScope.code === requestedCode));
        assert.ok(events.reduce((sum, event) => sum + event.hits, 0) >= (requestedType === 'default' ? 1 : requestedType === 'stores' ? 4 : 3), 'Code, ID, object and current-store reads must agree');
    });
}
test('equal-valued DB override does not execute its XML fallback', () => {
    const result = report();
    assert.deepEqual(request(result, 'database-override').events, []);
    assert.equal(declaration(result, config, prefix + 'overridden').state, 'uncovered');
});
test('Backend-only value and flag reads execute their XML defaults', () => {
    const result = report();
    const events = request(result, 'backend-reads').events;
    for (const leaf of ['heading', 'enabled']) {
        const item = declaration(result, config, 'application_blog/backend/' + leaf);
        assert.ok(events.some(event => event.id === item.id && event.type === 'config-read'));
    }
});
test('mixed-case store codes and their lowercase aliases select the same website origin', () => {
    const result = report();
    const item = declaration(result, config, prefix + 'heading', 'websites', 'journal_website');
    const events = request(result, 'store-alias-read').events.filter(event => event.id === item.id);
    assert.deepEqual(events.map(event => event.requestedScope.code).sort(), ['Journal_Mixed', 'journal_mixed'].sort());
});
test('false, multiline, subtree and missing reads retain precise leaf attribution', () => {
    const result = report();
    const events = request(result, 'value-reads').events;
    for (const name of ['enabled', 'multiline', 'empty']) assert.ok(events.some(event => event.id === declaration(result, config, prefix + name).id));
    const multiline = declaration(result, config, prefix + 'multiline');
    assert.ok(multiline.endLine > multiline.startLine);
    for (let line = multiline.startLine; line <= multiline.endLine; line++) assert.equal(result.files.find(file => file.path === config).lines[line].state, 'covered');
    const subtree = request(result, 'subtree-read').events;
    assert.equal(subtree.length, 2);
    for (const name of ['first', 'second']) assert.ok(subtree.some(event => event.id === declaration(result, config, 'application_blog/subtree/' + name).id));
    assert.deepEqual(request(result, 'missing-read').events, []);
});
test('Admin rendering distinguishes aliased, hidden and unopened field declarations', () => {
    const result = report();
    for (const name of ['heading', 'alias_one', 'alias_two']) {
        const item = declaration(result, system, 'application_blog/display/' + name);
        assert.equal(item.state, 'covered');
        assert.ok(item.evidence.some(event => event.type === 'system-field-render'));
    }
    for (const key of ['application_blog/display/hidden', 'application_blog_editorial/unused/unused']) {
        assert.equal(declaration(result, system, key).state, 'uncovered');
    }
});
test('repeated requests on warmed configuration preserve declaration and scope outcomes', () => {
    const result = report();
    const normalize = entry => entry.events.map(event => ({id: event.id, type: event.type, requestedScope: event.requestedScope}))
        .sort((a, b) => a.id.localeCompare(b.id));
    for (const name of [...scopeCases.map(([name]) => name), 'backend-reads', 'store-alias-read', 'value-reads', 'subtree-read', 'database-override', 'missing-read']) {
        const first = request(result, name), warm = request(result, name + '-warm');
        assert.notEqual(first.id, warm.id);
        assert.deepEqual(normalize(first), normalize(warm), name);
    }
});
test('reports exact observer declarations and scoped execution through Magento', () => {
    const result = report();
    assert.equal(result.observers.hook, true);
    const global = 'app/code/Application/Blog/etc/events.xml';
    const frontend = 'app/code/Application/Blog/etc/frontend/events.xml';
    const admin = 'app/code/Application/Blog/etc/adminhtml/events.xml';
    const event = 'magelens_journal_observers/';
    const first = declaration(result, global, event + 'global_journal', 'global');
    const second = declaration(result, frontend, event + 'frontend_journal', 'frontend');
    const adminObserver = declaration(result, admin, 'controller_front_send_response_before/admin_journal', 'adminhtml');
    for (const [item, file, start, end, area] of [[first, global, 9, 10, 'frontend'], [second, frontend, 9, 9, 'frontend'],
        [adminObserver, admin, 9, 9, 'adminhtml']]) {
        assert.deepEqual([item.startLine, item.endLine], [start, end]);
        assert.equal(item.areas[area].state, 'covered');
        assert.ok(item.evidence.every(evidence => evidence.type === 'observer-execute' && evidence.area === area
            && evidence.run === result.run && evidence.registration.observer === item.registration.observer));
        const html = fs.readFileSync(path.join(directory, 'xml', file + '.html'), 'utf8');
        assert.ok(html.includes(`href="#L${start}">${item.path}</a>`));
    }
    assert.equal(first.areas.adminhtml.state, 'uncovered');
    assert.equal(declaration(result, global, event + 'disabled_in_frontend', 'global').areas.frontend.status, 'disabled');
    assert.equal(declaration(result, frontend, event + 'disabled_in_frontend', 'frontend').areas.frontend.status, 'disabled');
    assert.equal(declaration(result, global, event + 'external_override', 'global').areas.frontend.status, 'overridden');
    assert.ok(!result.files.some(file => file.path.includes('ObserverOverride')));
    for (const name of ['warmup', 'unvisited']) {
        const item = declaration(result, global, `magelens_journal_${name}/${name}`, 'global');
        assert.equal(item.areas.frontend.state, 'uncovered');
        assert.deepEqual(item.evidence, []);
    }
    for (const name of ['observer-dispatch', 'observer-dispatch-warm']) {
        const events = request(result, name).events.filter(event => event.type === 'observer-execute');
        assert.deepEqual(events.map(event => event.id).sort(), [first.id, second.id].sort());
        assert.ok(events.every(event => event.hits === 1 && event.area === 'frontend'));
    }
});

test('reports original DI registrations and the actual frontend and Admin plugin chains', () => {
    const result = report();
    const root = 'app/code/Application/Blog/etc/';
    const declarations = scope => Object.fromEntries(result.files.find(file => file.path === root + scope + 'di.xml')
        .declarations.filter(item => item.family === 'plugins').map(item => [item.registration.name, item]));
    const global = declarations(''), frontend = declarations('frontend/'), admin = declarations('adminhtml/');
    const subject = 'Application\\Blog\\Model\\JournalPluginSubject';
    const assertCallback = (item, area, method, phase, state) => {
        assert.equal(item.areas[area].status, 'eligible');
        const callback = Object.values(item.areas[area].callbacks).find(entry => entry.method === method && entry.phase === phase);
        assert.deepEqual({subject: callback.subject, method: callback.method, phase: callback.phase, state: callback.state},
            {subject, method, phase, state});
        return callback.hits;
    };
    assert.deepEqual(result.plugins, {total: 50 + 4, covered: 16 + 3, hook: true});
    assert.deepEqual([global.journal_shared.startLine, global.journal_shared.endLine], [9, 10]);
    assert.equal(global.journal_shared.registration.target, subject + 'Interface');
    assert.deepEqual([global.journal_duplicate.startLine, global.journal_duplicate.endLine], [14, 14]);
    assert.equal(global.journal_duplicate.registration.target, subject);
    assert.equal(assertCallback(global.journal_shared, 'frontend', 'probe', 'before', 'covered'), 2);
    assert.equal(assertCallback(global.journal_duplicate, 'frontend', 'probe', 'before', 'covered'), 2);
    assert.equal(assertCallback(global.journal_short, 'frontend', 'probe', 'around', 'covered'), 2);
    assert.equal(assertCallback(global.journal_outer_after, 'frontend', 'probe', 'after', 'covered'), 2);
    assert.equal(assertCallback(global.journal_inner_after, 'frontend', 'probe', 'after', 'uncovered'), 0);
    assert.equal(assertCallback(global.journal_warm, 'frontend', 'warm', 'after', 'uncovered'), 0);
    assert.equal(assertCallback(global.journal_warm, 'frontend', 'unused', 'before', 'uncovered'), 0);
    assert.equal(global.journal_disabled.areas.frontend.status, 'disabled');
    assert.equal(frontend.journal_disabled.areas.frontend.status, 'disabled');
    assert.equal(global.journal_external.areas.frontend.status, 'overridden');
    assert.equal(global.journal_shared.areas.global.state, 'uncovered');
    assert.deepEqual([frontend.journal_frontend.startLine, frontend.journal_frontend.endLine], [10, 10]);
    assert.deepEqual([admin.journal_admin.startLine, admin.journal_admin.endLine], [9, 9]);
    assertCallback(frontend.journal_frontend, 'frontend', 'probe', 'before', 'covered');
    assertCallback(admin.journal_admin, 'adminhtml', 'probe', 'after', 'covered');
    for (const name of ['observer-dispatch', 'observer-dispatch-warm']) {
        const events = request(result, name).events.filter(event => event.type === 'plugin-execute');
        assert.deepEqual(events.map(event => [event.name, event.callback.phase, event.area, event.callback.subject, event.hits]), [
            ['journal_shared', 'before', 'frontend', subject, 1],
            ['journal_duplicate', 'before', 'frontend', subject, 1],
            ['journal_frontend', 'before', 'frontend', subject, 1],
            ['journal_short', 'around', 'frontend', subject, 1],
            ['journal_outer_after', 'after', 'frontend', subject, 1]
        ]);
    }
});

test('reports preference resolution by native binding and original configuration area', () => {
    const result = report();
    assert.deepEqual(result.preferences, {total: 53, covered: 8, hook: true});
    const root = 'app/code/Application/Blog/etc/';
    const globalFile = result.files.find(file => file.path === root + 'di.xml');
    assert.deepEqual([globalFile.covered, globalFile.total], [0, 0]);
    assert.equal(globalFile.lines[30].state, 'covered');
    const model = 'Application\\Blog\\Model\\Journal';
    const bind = (name, scope = 'global') => declaration(result,
        root + (scope === 'global' ? '' : scope + '/') + 'di.xml', model + name, scope);
    const first = bind('First'), second = bind('Second'), chain = bind('Chain'), virtual = bind('VirtualPreference');
    const frontend = bind('AreaPreference', 'frontend'), admin = bind('AreaPreference', 'adminhtml');
    const base = bind('AreaPreference'), external = bind('ExternalPreference');
    const cases = [
        [first, 21, 22, model + 'PreferenceProbe', model + 'PreferenceProbe'],
        [second, 23, 23, model + 'PreferenceProbe', model + 'PreferenceProbe'],
        [chain, 24, 24, model + 'First', model + 'PreferenceProbe'],
        [virtual, 29, 29, model + 'VirtualTarget', model + 'PreferenceProbe'],
        [frontend, 12, 12, model + 'FrontendPreference', model + 'FrontendPreference'],
        [admin, 11, 11, model + 'PluginSubject', model + 'PluginSubject']
    ];
    for (const [item, start, end, replacement, resolved] of cases) {
        assert.deepEqual([item.startLine, item.endLine], [start, end]);
        assert.equal(item.binding.replacement, replacement);
        const area = item === admin ? 'adminhtml' : 'frontend';
        const outcome = item.areas[area];
        assert.equal(outcome.state, 'covered');
        assert.equal(outcome.origin.id, item.id);
        assert.deepEqual([outcome.origin.startLine, outcome.origin.endLine], [start, end]);
        assert.equal(outcome.resolved, resolved);
        assert.ok(item.evidence.every(entry => entry.type === 'preference-resolved' && entry.area === area
            && entry.run === result.run && entry.resolved === resolved));
    }
    assert.equal(base.areas.global.state, 'uncovered');
    assert.equal(base.areas.frontend.status, 'overridden');
    assert.equal(base.areas.frontend.origin.id, frontend.id);
    assert.equal(base.areas.adminhtml.status, 'overridden');
    assert.equal(base.areas.adminhtml.origin.id, admin.id);
    assert.equal(frontend.areas.adminhtml.status, 'inactive');
    assert.equal(admin.areas.frontend.status, 'inactive');
    const externalOutcome = external.areas.frontend;
    assert.equal(externalOutcome.status, 'overridden');
    assert.equal(externalOutcome.origin.path, 'app/code/MageLens/Compatibility/Test/ObserverOverride/etc/frontend/di.xml');
    assert.equal(externalOutcome.origin.startLine, 11);
    assert.ok(!result.files.some(file => file.path === externalOutcome.origin.path));
    for (const name of ['UnusedPreference', 'WarmPreference', 'FailedPreference']) {
        const item = bind(name);
        assert.equal(item.areas.frontend.state, 'uncovered');
        assert.deepEqual(item.evidence, []);
    }
    for (const name of ['preference-resolution', 'preference-resolution-warm']) {
        const events = request(result, name).events.filter(event => event.type === 'preference-resolved');
        const expected = [[first, 'First', 2], [second, 'Second', 1], [chain, 'Chain', 1], [first, 'Chain', 1],
            [frontend, 'AreaPreference', 1], [virtual, 'VirtualPreference', 1]];
        assert.deepEqual(events.map(event => [event.id, event.requested, event.hits]).sort(),
            expected.map(([item, requested, hits]) => [item.id, model + requested, hits]).sort());
    }
    const html = fs.readFileSync(path.join(directory, 'xml/index.html'), 'utf8');
    assert.match(html, /Preference usage/);
    assert.match(html, /8\/53 eligible declaration–area pairs resolved/);
    assert.match(html, /href="app\/code\/Application\/Blog\/etc\/di.xml.html#L21"/);
});

test('reports only factory-resolved virtual types and applied constructor arguments', () => {
    const result = report();
    assert.deepEqual(result.virtualTypes, {total: 18 + 2, covered: 9 + 2, hook: true});
    assert.deepEqual(result.arguments, {total: 43 + 14, covered: 19 + 14, hook: true});
    assert.deepEqual(result.lifecycles, {total: 6, covered: 4, hook: true});
    const root = 'app/code/Application/Blog/etc/';
    const model = 'Application\\Blog\\Model\\Journal';
    const site = (type, scope = 'global', argument = '') => declaration(result,
        root + (scope === 'global' ? '' : scope + '/') + 'di.xml', model + type + (argument ? '/' + argument : ''), scope, '',
        argument ? 'arguments' : 'virtual-types');
    const alias = site('ArgumentAlias'), frontend = site('ArgumentAlias', 'frontend'), admin = site('ArgumentAlias', 'adminhtml');
    const chain = site('ArgumentChain'), serviceType = site('VirtualTarget');
    const argument = name => site('ArgumentProbe', 'global', name);
    const enabled = argument('options[enabled]');
    const lifetime = result.files.find(file => file.path === root + 'di.xml').declarations.find(item => item.family === 'lifecycles');
    const frontendLabel = site('ArgumentAlias', 'frontend', 'label'), adminLabel = site('ArgumentAlias', 'adminhtml', 'label');
    assert.deepEqual([alias.startLine, alias.highlightEndLine, alias.endLine], [42, 43, 45]);
    assert.equal(alias.areas.frontend.status, 'overridden');
    assert.equal(alias.areas.frontend.origin.id, frontend.id);
    assert.equal(frontend.areas.frontend.resolved, model + 'ArgumentProbe');
    assert.deepEqual([argument('options').startLine, argument('options').endLine], [35, 37]);
    assert.deepEqual([enabled.startLine, enabled.endLine, enabled.binding.items], [36, 36, ['enabled']]);
    assert.equal(enabled.areas.global.state, 'uncovered');
    assert.equal(enabled.areas.frontend.state, 'covered');
    assert.deepEqual([lifetime.startLine, lifetime.endLine, lifetime.binding], [30, 30,
        {declaringType: model + 'VirtualTarget', shared: true}]);
    assert.equal(lifetime.areas.global.state, 'uncovered');
    assert.equal(lifetime.areas.frontend.state, 'covered');
    assert.equal(lifetime.areas.adminhtml.state, 'covered');
    assert.equal(argument('ignored').areas.frontend.state, 'uncovered');
    assert.equal(frontendLabel.areas.frontend.state, 'covered');
    assert.equal(adminLabel.areas.adminhtml.state, 'covered');
    assert.equal(admin.areas.adminhtml.state, 'covered');
    assert.deepEqual(site('ArgumentAlias', 'global', 'label').evidence, []);
    for (const name of ['preference-resolution', 'preference-resolution-warm']) {
        const events = request(result, name).events.filter(event => ['virtual-type-resolved', 'argument-applied', 'lifetime-applied'].includes(event.type));
        const expected = [
            [serviceType, 'VirtualTarget'], [chain, 'ArgumentChain'], [frontend, 'ArgumentChain'], [frontend, 'ArgumentAlias'],
            [frontendLabel, 'ArgumentChain'], [argument('options'), 'ArgumentChain'], [argument('options'), 'ArgumentAlias'],
            [argument('options'), 'ArgumentProbe'], [argument('service'), 'ArgumentChain'], [argument('service'), 'ArgumentAlias'],
            [argument('service'), 'ArgumentProbe'], [argument('label'), 'ArgumentProbe'],
            [enabled, 'ArgumentChain'], [enabled, 'ArgumentAlias'], [enabled, 'ArgumentProbe'],
            [lifetime, 'ArgumentChain'], [lifetime, 'ArgumentAlias'], [lifetime, 'ArgumentProbe'],
        ];
        assert.deepEqual(events.map(event => [event.id, event.requested, event.hits]).sort(),
            expected.map(([item, type]) => [item.id, model + type, 1]).sort());
    }
    const html = fs.readFileSync(path.join(directory, 'xml/index.html'), 'utf8');
    assert.match(html, /Virtual type usage/);
    assert.match(html, /Constructor argument usage/);
    assert.match(html, /11\/20 eligible declaration–area pairs resolved/);
    assert.match(html, /33\/57 eligible declaration–area pairs applied/);
    assert.match(html, /4\/6 eligible declaration–area pairs applied/);
});

test('reports the additional frontend DI declarations for the layout fixtures', () => {
    const result = report();
    const file = result.files.find(entry => entry.path === layoutFixtureDi);
    const fixture = family => file.declarations.filter(item => item.family === family);
    assert.deepEqual(fixture('plugins').map(item => [item.path, item.areas.frontend.state]), [
        ['MageLens\\Compatibility\\Block\\LayoutTemplateValueIntercepted/magelens_template_value_unused', 'uncovered'],
        ['Magento\\Framework\\View\\Layout\\GeneratorPool/magelens_layout_move_mutation', 'covered'],
        [`${cacheDispatchSubject}/${cachePluginName}`, 'covered'],
        [`Magento\\Framework\\App\\PageCache\\Kernel/${cachePluginName}`, 'covered'],
    ]);
    assert.deepEqual(fixture('virtual-types').map(item => [item.path, item.areas.frontend.state]), [
        ['MageLensCompatibilityIsolatedLayout', 'covered'],
        ['MageLensCompatibilityIsolatedLayoutFactory', 'covered'],
    ]);
    const expectedArguments = [
        'MageLensCompatibilityIsolatedLayout/isIsolated',
        'MageLensCompatibilityIsolatedLayoutFactory/instanceName',
        ...['Dynamic', 'Cachepage', 'Shared', 'Database', 'Renderfailure', 'Propertyownership', 'Dependencies',
            'References', 'Templatevalues', 'Actionfailure', 'Grammar', 'Moves']
            .map(controller => `MageLens\\Compatibility\\Controller\\${controller}\\Index/layouts`),
    ];
    assert.deepEqual(fixture('arguments').map(item => [item.path, item.areas.frontend.state]),
        expectedArguments.map(argument => [argument, 'covered']));
});

test('attributes real REST and GraphQL calls to their own DI and observer sources', () => {
    const result = report();
    const root = 'app/code/Application/Blog/etc/';
    const model = 'Application\\Blog\\Model\\Journal';
    for (const [area, name, other] of [
        ['webapi_rest', 'rest_probe', 'graphql'],
        ['graphql', 'graphql_probe', 'webapi_rest']
    ]) {
        const file = root + area + '/di.xml';
        const eventFile = root + area + '/events.xml';
        const binding = declaration(result, file, model + 'AreaPreference', area);
        const alias = declaration(result, file, model + 'ArgumentAlias', area, '', 'virtual-types');
        const label = declaration(result, file, model + 'ArgumentAlias/label', area);
        const plugin = declaration(result, file, model + 'PluginSubject/' + name, area);
        const observer = declaration(result, eventFile, 'magelens_api_probe/' + name, area);
        const expected = [[binding, 8, 8, 'preference-resolved'], [alias, 9, 11, 'virtual-type-resolved'],
            [label, 10, 10, 'argument-applied'], [plugin, 13, 13, 'plugin-execute'], [observer, 9, 9, 'observer-execute']];
        const requests = result.requests.filter(entry => entry.events.some(event => event.id === binding.id));
        assert.equal(requests.length, 1, `One recorded request resolved the ${area} fixture binding`);
        const [record] = requests;
        const events = record.events;
        const selected = new Set(expected.map(([item]) => item.id));
        assert.deepEqual(events.filter(event => selected.has(event.id)).map(event => [event.id, event.type, event.area, event.hits]).sort(),
            expected.map(([item, , , kind]) => [item.id, kind, area, 1]).sort());
        assert.ok(events.every(event => !event.area || event.area === area), 'Only the native API area supplies fixture evidence');
        for (const [item, start, end] of expected) {
            assert.deepEqual([item.startLine, item.endLine], [start, end]);
            assert.equal(item.areas[area].state, 'covered');
            assert.equal(item.areas[other]?.status ?? 'inactive', 'inactive');
        }
        const global = declaration(result, root + 'di.xml', model + 'AreaPreference', 'global');
        assert.equal(global.areas[area].status, 'overridden');
        assert.equal(global.areas[area].origin.id, binding.id);
        assert.equal(binding.areas[area].resolved, model + 'FrontendPreference');
        assert.match(fs.readFileSync(path.join(directory, 'xml', file + '.html'), 'utf8'), new RegExp(area + ' · Resolved'));
    }
});
