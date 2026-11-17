// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {snapshot, validateSnapshot, compareThemes} = require('./ci/report-equivalence.cjs');
const {writeCoverage} = require('./ci-coverage-fixture.cjs');
const {cases} = require('./ci/cases.cjs');
function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-equivalence-unit-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({id: 'fresh'}));
    return {directory, ...writeCoverage(directory)};
}
function reports(value) { return cases.map(entry => ({...entry, snapshot: structuredClone(value)})); }
test('complete snapshots preserve all measured sources without exposing private contents', t => {
    const {directory} = fixture(t);
    const value = snapshot(directory);
    for (const section of ['php', 'js', 'templates', 'xml']) {
        assert.equal(Object.keys(value[section].files).length, 2);
        assert.ok(Object.keys(value[section].files).some(key => key.startsWith('source-sha256:')));
    }
    assert.doesNotMatch(JSON.stringify(value), /SECRET|secret\(|vendor\/private|requests/);
    assert.equal(compareThemes(reports(value), cases).passed, true);
});
test('OS paths, line endings, ordering, counter IDs and repeated hits do not change coverage outcomes', t => {
    const {directory, read, write} = fixture(t);
    const before = snapshot(directory);
    const templates = read('templates/coverage-summary.json');
    templates.templates.reverse().forEach(entry => {entry.source = entry.source.replaceAll('\n', '\r\n'); entry.statements.reverse();});
    write('templates/coverage-summary.json', templates);
    for (const file of ['php/line-coverage.json', 'js/coverage-final.json']) {
        const data = read(file);
        if (file.startsWith('js')) for (const value of Object.values(data)) {
            value.s = {renamed: 17, other: 0};
            value.statementMap = {other: value.statementMap[1], renamed: value.statementMap[0]};
            value.f[0] = 6;
            value.b[0][0] = 9;
        }
        write(file, Object.fromEntries(Object.entries(data).reverse().map(([key, value]) => [key.replace('/shop/', 'D:/build/').replaceAll('/', '\\'), value])));
    }
    assert.deepEqual(snapshot(directory), before);
});
test('Istanbul empty library groups retain Unknown percentages, but nonempty unknown totals are invalid', t => {
    const {directory, read, write} = fixture(t);
    const value = snapshot(directory);
    assert.equal(value.js.groups.libraries.statements.pct, 'Unknown');
    assert.equal(value.js.groups.libraries.statements.total, 0);
    const summary = read('javascript-summary.json');
    summary.groups.libraries.statements.total = 1;
    write('javascript-summary.json', summary);
    assert.throws(() => snapshot(directory), /Invalid coverage total/);
});
test('same-theme comparisons include every required host report', t => {
    const {directory} = fixture(t);
    const all = reports(snapshot(directory));
    all.filter(entry => entry.theme === 'hyva').forEach(entry => {entry.snapshot.metrics.templates = 12;});
    assert.equal(compareThemes(all, cases).passed, true, 'Different themes are independent baselines');
    for (const entry of all.filter(entry => entry.os !== 'ubuntu-latest')) {
        const changed = structuredClone(all);
        changed.find(report => report.id === entry.id).snapshot.metrics.templates++;
        const result = compareThemes(changed, cases);
        assert.equal(result.passed, false);
        assert.equal(result.themes[entry.theme].differences[0].case, entry.id);
    }
});
test('JavaScript report groups, required execution and exclusions cannot differ behind identical counters', t => {
    const {directory} = fixture(t);
    const original = snapshot(directory);
    for (const mutate of [
        value => {value.js.inventory[Object.keys(value.js.inventory)[0]] = 'libraries';},
        value => {value.js.requiredExecuted.pop();},
        value => {value.js.excluded[0][1] = 'changed-exclusion';}
    ]) {
        const all = reports(original);
        mutate(all[1].snapshot);
        const result = compareThemes(all, cases);
        assert.equal(result.passed, false);
        assert.ok(result.themes.luma.differences.some(difference => difference.section === 'js'));
    }
});
test('equal percentages cannot conceal different executed files, statements, functions, branches or DOM observations', t => {
    const {directory} = fixture(t);
    const original = snapshot(directory);
    const privateKey = section => Object.keys(original[section].files).find(key => key.startsWith('source-sha256:'));
    const mutations = [
        value => {delete value.php.files[privateKey('php')];},
        value => {value.php.files[privateKey('php')]['1'] = true;},
        value => {value.js.files[privateKey('js')].statements[0][1] = false; value.js.files[privateKey('js')].statements[1][1] = true;},
        value => {value.js.files[privateKey('js')].functions[0][2] = false;},
        value => {value.js.files[privateKey('js')].functions[0][3] = 'changed-name';},
        value => {value.js.files[privateKey('js')].branches[0][2][1][1] = true;},
        value => {value.templates.files[privateKey('templates')].status = 'observed';},
        value => {value.templates.files[privateKey('templates')].source = 'changed';},
        value => {value.templates.files[privateKey('templates')].warnings.push('new-warning');},
        value => {value.templates.files[privateKey('templates')].statements[0][3] = true;},
        value => {value.templates.files[privateKey('templates')].functions[0][3] = true;},
        value => {value.templates.files[privateKey('templates')].branches[0][3] = true;}
    ];
    for (const mutate of mutations) {
        const all = reports(original);
        mutate(all[1].snapshot);
        const result = compareThemes(all, cases);
        assert.equal(result.passed, false);
        assert.ok(result.themes.luma.differences.some(difference => difference.file?.startsWith('source-sha256:')));
    }
});
test('missing or duplicate host cases and stale or incomplete reports cannot satisfy equivalence', t => {
    const {directory, read, write} = fixture(t);
    const value = snapshot(directory), all = reports(value);
    assert.equal(compareThemes(all.slice(0, -1), cases).passed, false);
    assert.equal(compareThemes([...all.slice(0, -1), all[0]], cases).passed, false);
    assert.throws(() => validateSnapshot({...value, run: 'old'}, 'fresh', read('summary.json')), /Stale/);
    const incomplete = structuredClone(value);
    delete Object.values(incomplete.js.files)[0].functions;
    assert.throws(() => validateSnapshot(incomplete, 'fresh', read('summary.json')), /Missing coverage inventory/);
    const scope = read('javascript-scope.json');
    write('javascript-scope.json', {...scope, included: scope.included.slice(0, 1)});
    assert.throws(() => snapshot(directory), /Incomplete JavaScript source inventory/);
    write('javascript-scope.json', scope);
    const js = read('js/coverage-final.json');
    delete Object.values(js)[0].f;
    write('js/coverage-final.json', js);
    assert.throws(() => snapshot(directory), /Missing coverage map/);
});
test('observer equivalence retains registration, per-area outcomes, source and warnings', t => {
    const {directory, read, write} = fixture(t);
    const xml = read('xml/coverage.json');
    const registration = {event: 'SECRET_event', observer: 'SECRET_observer'};
    const [file] = xml.files;
    file.declarations.push({id: 'observer', family: 'events', path: 'SECRET_event/SECRET_observer',
        declaredScope: {type: 'global', code: ''}, startLine: 3, endLine: 5, supported: true, effective: true, state: 'covered',
        registration, areas: {frontend: {status: 'eligible', state: 'covered', hits: 1},
            adminhtml: {status: 'ambiguous', state: 'unmeasured', hits: 0, reason: 'SECRET reason'}},
        evidence: [{type: 'observer-execute', area: 'frontend', registration, request: 'SECRET request'}]});
    xml.warnings.push({path: file.path, declaration: 'observer', area: 'adminhtml', reason: 'SECRET reason'});
    xml.observers = {total: 1, covered: 1, hook: true};
    write('xml/coverage.json', xml);
    const original = snapshot(directory);
    assert.doesNotMatch(JSON.stringify(original), /SECRET/);
    const observer = file.declarations.at(-1);
    observer.areas.frontend.hits = 99;
    observer.evidence.push({...observer.evidence[0], request: 'repeat'});
    write('xml/coverage.json', xml);
    assert.deepEqual(snapshot(directory), original);
    observer.areas.adminhtml.status = 'unsupported';
    write('xml/coverage.json', xml);
    const matrix = reports(original);
    matrix[1].snapshot = snapshot(directory);
    assert.equal(compareThemes(matrix, cases).passed, false);
});

test('plugin equivalence preserves phase, registration and outcomes while normalizing repeat counts', t => {
    const {directory, read, write} = fixture(t);
    const xml = read('xml/coverage.json'), [file] = xml.files;
    const registration = {target: 'SECRET\\Contract', name: 'SECRET_registration'};
    const callback = {subject: 'SECRET\\Subject', method: 'save', phase: 'before'};
    const plugin = {id: 'plugin', family: 'plugins', path: 'SECRET declaration', declaredScope: {type: 'global', code: ''},
        startLine: 3, endLine: 4, supported: true, effective: true, state: 'covered', registration,
        areas: {frontend: {status: 'eligible', state: 'covered', hits: 1, callbacks: {key: {...callback, state: 'covered', hits: 1}}},
            adminhtml: {status: 'ambiguous', state: 'unmeasured', hits: 0, callbacks: [], reason: 'SECRET reason'}},
        evidence: [{type: 'plugin-execute', area: 'frontend', registration, callback, request: 'SECRET request'}]};
    file.declarations.push(plugin);
    xml.plugins = {total: 1, covered: 1, hook: true};
    xml.warnings.push({path: file.path, declaration: plugin.id, area: 'adminhtml', reason: 'SECRET reason'});
    write('xml/coverage.json', xml);
    const original = snapshot(directory);
    assert.doesNotMatch(JSON.stringify(original), /SECRET/);
    plugin.areas.frontend.hits = plugin.areas.frontend.callbacks.key.hits = 99;
    plugin.evidence.push({...plugin.evidence[0], request: 'repeat'});
    write('xml/coverage.json', xml);
    assert.deepEqual(snapshot(directory), original);
    for (const mutate of [
        item => {item.registration.name = 'Different';},
        item => {item.areas.frontend.callbacks.key.phase = 'around';},
        item => {item.areas.frontend.callbacks.key.ambiguousEntry = true;},
        item => {item.areas.adminhtml.status = 'unsupported';}
    ]) {
        const changed = structuredClone(xml);
        mutate(changed.files[0].declarations.at(-1));
        write('xml/coverage.json', changed);
        const matrix = reports(original);
        matrix[1].snapshot = snapshot(directory);
        assert.equal(compareThemes(matrix, cases).passed, false);
    }
    write('xml/coverage.json', xml);
    const withoutGeneratorWarning = snapshot(directory);
    const warning = {path: file.path, declaration: plugin.id, area: 'frontend',
        reason: 'SECRET Subject::stream (around) — Generator callback bodies execute on iteration outside synchronous plugin coverage'};
    xml.warnings.push(warning);
    write('xml/coverage.json', xml);
    const withGeneratorWarning = snapshot(directory);
    const matrix = reports(withoutGeneratorWarning);
    matrix[1].snapshot = withGeneratorWarning;
    assert.equal(compareThemes(matrix, cases).passed, false);
    assert.doesNotMatch(JSON.stringify(withGeneratorWarning), /SECRET/);
    xml.plugins.total = 0;
    write('xml/coverage.json', xml);
    assert.throws(() => snapshot(directory), /Incomplete plugin coverage inventory/);
});

test('preference equivalence retains binding, original provider and per-area resolution', t => {
    const {directory, read, write} = fixture(t);
    const xml = read('xml/coverage.json'), [file] = xml.files;
    const id = '1'.repeat(64);
    const binding = {requested: 'SECRET\\Contract', replacement: 'SECRET\\Virtual'};
    const resolved = 'SECRET\\Concrete';
    const origin = {id, path: file.path, startLine: 4, endLine: 6, fingerprint: file.sourceFingerprint};
    const external = {...origin, id: '2'.repeat(64), path: '/shop/vendor/SECRET/other/etc/di.xml'};
    const eligible = {status: 'eligible', state: 'uncovered', hits: 0, origin, effectiveReplacement: binding.replacement, resolved};
    const selected = {type: 'preference-resolved', area: 'frontend', requested: 'SECRET\\RootAlias', binding, resolved};
    const rest = {...selected, area: 'webapi_rest'};
    const item = {id, family: 'preferences', path: binding.requested, declaredScope: {type: 'global', code: ''},
        startLine: 4, endLine: 6, supported: true, effective: true, state: 'covered', binding, evidence: [selected, rest],
        areas: {global: eligible, frontend: {...eligible, state: 'covered', hits: 1},
            webapi_rest: {...eligible, state: 'covered', hits: 1}, graphql: {...eligible},
            adminhtml: {status: 'overridden', state: 'unmeasured', hits: 0, origin: external,
                resolved: 'SECRET\\Admin', effectiveReplacement: 'SECRET\\Admin', reason: 'SECRET provider'}}};
    file.declarations.push(item);
    xml.preferences = {total: 4, covered: 2, hook: true};
    write('xml/coverage.json', xml);
    const original = snapshot(directory);
    assert.doesNotMatch(JSON.stringify(original), /SECRET/);
    item.areas.frontend.hits = 90;
    item.evidence.push({...selected, request: 'second'});
    external.path = 'D:\\workspace\\vendor\\SECRET\\other\\etc\\di.xml';
    write('xml/coverage.json', xml);
    assert.deepEqual(snapshot(directory), original);
    for (const update of [
        item => { item.binding.requested += 'Renamed'; },
        item => { item.areas.adminhtml.origin.endLine++; },
        item => { item.areas.adminhtml.origin.fingerprint = '3'.repeat(64); },
        item => { item.areas.frontend.resolved += 'Changed'; },
        item => { item.areas.graphql.resolved += 'Changed'; },
        (item, report) => {
            item.areas.webapi_rest.hits = 0;
            item.areas.webapi_rest.state = 'uncovered';
            item.evidence = item.evidence.filter(event => event.area !== 'webapi_rest');
            report.preferences.covered = 1;
        }
    ]) {
        const changed = structuredClone(xml);
        update(changed.files[0].declarations.at(-1), changed);
        write('xml/coverage.json', changed);
        const matrix = reports(original);
        matrix[1].snapshot = snapshot(directory);
        assert.equal(compareThemes(matrix, cases).passed, false);
    }
    xml.preferences.total = 3;
    write('xml/coverage.json', xml);
    assert.throws(() => snapshot(directory), /Incomplete preference coverage inventory/);
});

test('factory DI equivalence retains virtual routes and inherited parameter identities', t => {
    const {directory, read, write} = fixture(t);
    const xml = read('xml/coverage.json'), file = xml.files[0];
    const resolved = 'SECRET\\Concrete';
    const add = (family, id, binding, type, expected) => {
        const origin = {id, path: file.path, startLine: 4, endLine: 5, fingerprint: file.sourceFingerprint};
        const eligible = {status: 'eligible', origin, resolved: expected, effectiveReplacement: expected, state: 'uncovered', hits: 0};
        const item = {id, path: 'SECRET declared path', family, binding, declaredScope: {type: 'global', code: ''},
            startLine: 4, endLine: 5, supported: true, effective: true, state: 'covered',
            areas: {global: eligible, frontend: {...eligible, state: 'covered', hits: 1},
                adminhtml: {status: 'ambiguous', state: 'unmeasured', hits: 0, reason: 'SECRET conflicting provider'}},
            evidence: [{type, binding, area: 'frontend', resolved: expected, request: 'SECRET request', requested: 'SECRET\\AliasChain'}]};
        file.declarations.push(item);
        return item;
    };
    const alias = add('virtual-types', 'a'.repeat(64), {requested: 'SECRET\\Alias', replacement: resolved}, 'virtual-type-resolved', resolved);
    const lifetime = add('lifecycles', 'c'.repeat(64), {declaringType: resolved, shared: false}, 'lifetime-applied', null);
    const argument = add('arguments', 'b'.repeat(64), {declaringType: resolved, argument: 'SECRET parameter', items: ['SECRET item']}, 'argument-applied', null);
    xml.virtualTypes = {total: 2, covered: 1, hook: true};
    xml.arguments = {total: 2, covered: 1, hook: true};
    xml.lifecycles = {total: 2, covered: 1, hook: true};
    write('xml/coverage.json', xml);
    const original = snapshot(directory);
    assert.doesNotMatch(JSON.stringify(original), /SECRET/);
    alias.areas.frontend.hits = argument.areas.frontend.hits = lifetime.areas.frontend.hits = 60;
    argument.evidence.push({...argument.evidence[0], request: 'another'});
    write('xml/coverage.json', xml);
    assert.deepEqual(snapshot(directory), original);
    const last = report => report.files[0].declarations.at(-1);
    for (const alter of [
        value => { last(value).binding.argument = 'changed'; },
        value => { last(value).binding.items = ['changed']; },
        value => { value.files[0].declarations.find(item => item.family === 'lifecycles').binding.shared = true; },
        value => { last(value).evidence[0].requested = 'different requester'; },
        value => { last(value).areas.global.origin.fingerprint = 'f'.repeat(64); },
        value => { last(value).areas.frontend.hits = 0; last(value).areas.frontend.state = 'uncovered'; value.arguments.covered = 0; }
    ]) {
        const changed = structuredClone(xml);
        alter(changed);
        write('xml/coverage.json', changed);
        const matrix = reports(original);
        matrix[1].snapshot = snapshot(directory);
        assert.equal(compareThemes(matrix, cases).passed, false);
    }
});
