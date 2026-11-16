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
const prefix = 'application_blog/display/';
function report() {
    const value = read('xml/coverage.json');
    assert.equal(value.run, read('run.json').id);
    assert.equal(value.complete, true);
    assert.equal(value.sourcesUnchanged, true);
    assert.deepEqual(value.collectorErrors, []);
    return value;
}
function declaration(result, file, key, type = 'default', code = '') {
    const matches = result.files.find(entry => entry.path === file)?.declarations
        .filter(item => item.path === key && item.declaredScope.type === type && item.declaredScope.code === code);
    assert.equal(matches?.length, 1, `${key} at ${type}/${code}`);
    return matches[0];
}
function request(result, name) {
    const requests = result.requests.filter(entry => entry.case === name);
    assert.equal(requests.length, 1, `Expected exactly one real request for ${name}`);
    return requests[0];
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
