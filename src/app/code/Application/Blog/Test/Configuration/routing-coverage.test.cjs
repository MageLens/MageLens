// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {test} = require('node:test');
const {readXmlJson} = require('../../../../../../../bin/xml-report/json.cjs');
const coverage = process.env.MAGELENS_XML_ACCEPTANCE_DIR || 'coverage';
const read = name => JSON.parse(fs.readFileSync(path.join(coverage, name)));
const result = readXmlJson(path.join(coverage, 'xml/coverage.json'));
assert.equal(result.run, read('run.json').id);
const blog = 'app/code/Application/Blog/etc';
const compatibility = 'app/code/MageLens/Compatibility/etc/frontend/routes.xml';

function source(file, identity, expectedLine, snippet) {
    const entry = result.files.find(entry => entry.path === file);
    assert.ok(entry, file);
    const bytes = fs.readFileSync(path.join('src', file));
    assert.equal(entry.sourceHash, createHash('sha256').update(bytes).digest('hex'));
    const declaration = entry.declarations.find(item => item.path === identity);
    assert.ok(declaration, identity);
    assert.equal(declaration.startLine, expectedLine);
    assert.ok(bytes.toString().split('\n')[expectedLine - 1].includes(snippet));
    return declaration;
}

const raw = path.join(coverage, 'raw/php', result.run);
const traces = fs.readdirSync(raw).filter(file => /^[a-f0-9]+\.json$/.test(file)).map(file => {
    const data = JSON.parse(fs.readFileSync(path.join(raw, file)));
    return {id: file.slice(0, -5), method: data.method, uri: data.uri};
}).filter(trace => trace.uri);
function events(uri, method, search) {
    const records = traces.filter(trace => {
        const url = new URL(trace.uri, 'https://application.invalid');
        return uri.test(url.pathname) && (!method || trace.method === method)
            && (search === undefined || url.search === search);
    });
    assert.ok(records.length > 0, 'No current native request for ' + uri);
    const ids = new Set(records.map(trace => trace.id));
    return result.requests.filter(request => ids.has(request.id)).flatMap(request => request.events);
}
const stages = (events, id) => [...new Set(events
    .filter(event => id ? event.id === id : event.type.startsWith('webapi-'))
    .map(event => event.type + '/' + event.outcome))].sort();

test('attributes the Blog front name and the winning competing module at their original lines', () => {
    const root = source(blog + '/frontend/routes.xml', 'frontend/standard/blog', 9, 'frontName="blog"');
    const original = source(blog + '/frontend/routes.xml', 'frontend/standard/blog/Application_Blog', 9, 'Application_Blog');
    const winner = source(compatibility, 'frontend/standard/blog/MageLens_Compatibility', 11, 'before="Application_Blog"');
    const seen = events(/^\/blog\/index\/routeprobe\/?$/);
    for (const item of [root, winner]) {
        assert.deepEqual(stages(seen, item.id), ['route-handler-entered/entered', 'route-match/matched']);
    }
    assert.deepEqual(stages(seen, original.id), []);
    const fallback = events(/^\/blog\/index\/configuration\/?$/);
    assert.deepEqual(stages(fallback, original.id), ['route-handler-entered/entered', 'route-match/matched']);
    assert.deepEqual(stages(fallback, winner.id), []);
});

function routeDeclarations(route, line) {
    const identity = 'frontend/standard/' + route;
    return [
        source(compatibility, identity, line, 'id="' + route + '"'),
        source(compatibility, identity + '/MageLens_Compatibility', line, 'MageLens_Compatibility')
    ];
}

function assertRouteEffects(seen, expected) {
    const actual = seen.filter(event => event.type.startsWith('route-'));
    assert.deepEqual([...new Set(actual.map(event => event.id))].sort(), expected.map(([item]) => item.id).sort());
    for (const [item, effects] of expected) assert.deepEqual(stages(actual, item.id), effects);
}

const matched = ['route-handler-entered/entered', 'route-match/matched'];

test('attributes alphabetic and numeric IDs including a distinct leading-zero ID', () => {
    for (const [front, route, line] of [
        ['coverageprobe', 'coverageprobe', 9], ['catalogue', '123', 13], ['alternatecatalogue', '0123', 14]
    ]) {
        const declarations = routeDeclarations(route, line);
        for (const item of declarations) assert.equal(item.supported, true, item.path);
        assertRouteEffects(events(new RegExp('^/' + front + '/index/catalogue$'), 'GET', ''),
            declarations.map(item => [item, matched]));
    }
});

test('a native after plugin displaces route metadata while preserving the original controller selection', () => {
    const [route, module] = routeDeclarations('123', 13);
    const seen = events(/^\/catalogue\/index\/catalogue$/, 'GET', '?rewrite=1');
    assertRouteEffects(seen, [
        [route, ['route-handler-entered/entered', 'route-match/displaced']],
        [module, matched]
    ]);
});

test('preserves the first native owner when front names compare equal', () => {
    const selected = routeDeclarations('collisionwinner', 15);
    for (const item of routeDeclarations('collisionloser', 16)) {
        assert.equal(item.supported, false);
        assert.equal(item.outcome, 'displaced');
        assert.match(item.reason, /preceding native route owns the same front name/);
    }
    assertRouteEffects(events(/^\/350\/index\/catalogue$/, 'GET', ''), selected.map(item => [item, matched]));
});

test('attributes the native Blog Admin route and controller entry', () => {
    const route = source(blog + '/adminhtml/routes.xml', 'adminhtml/admin/application_blog', 9, 'frontName="application_blog"');
    const module = source(blog + '/adminhtml/routes.xml', 'adminhtml/admin/application_blog/Application_Blog', 9, 'Application_Blog');
    const seen = events(/\/application_blog\/manage\/index\b/);
    assertRouteEffects(seen, [[route, matched], [module, matched]]);
    assert.ok(seen.filter(event => event.type.startsWith('route-')).every(event => event.area === 'adminhtml'));
});

test('keeps synchronous REST selection, permission, and handler entry distinct', () => {
    const file = blog + '/webapi.xml';
    const exact = source(file, 'GET /V1/magelens/area-probe', 8, 'method="GET"');
    const variable = source(file, 'GET /V1/magelens/area-probe/:scenario', 12, ':scenario');
    const denied = source(file, 'GET /V1/magelens/area-probe/restricted', 16, '/restricted');
    const unused = source(file, 'GET /V1/magelens/area-probe/unused', 20, '/unused');
    const cached = source(file, 'GET /V1/magelens/area-probe/cached', 24, '/cached');
    const success = ['webapi-handler-entered/entered', 'webapi-match/matched', 'webapi-permission/allowed'];
    for (const [suffix, item, expected] of [
        ['', exact, success], ['/free', variable, success],
        ['/restricted', denied, ['webapi-match/matched', 'webapi-permission/denied']],
        ['/cached', cached, ['webapi-match/matched', 'webapi-permission/allowed']]
    ]) {
        const seen = events(new RegExp('/V1/magelens/area-probe' + suffix + '$'), 'GET');
        assert.deepEqual(stages(seen, item.id), expected);
        assert.deepEqual(stages(seen), expected);
        assert.ok(seen.filter(event => event.type.startsWith('webapi-')).every(event => event.id === item.id));
    }
    assert.deepEqual(stages(events(/\/V1\/magelens\/area-probe$/, 'PUT')), []);
    assert.deepEqual(stages(events(/\/graphql\/?$/)), [], 'A GraphQL resolver calls the same PHP service directly');
    assert.equal(unused.state, 'uncovered');
    assert.deepEqual(unused.evidence, []);
});
