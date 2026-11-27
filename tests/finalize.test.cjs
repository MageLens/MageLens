// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {projectFile} = require('./project-path.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite');
const {writeXmlJson} = require(projectFile('bin/xml-report/json.cjs'));

function reports(t, covered, runner = 'cypress') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-finalize-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const json = (file, data) => fs.writeFileSync(path.join(root, file), JSON.stringify(data));
    const percent = covered * 100;
    for (const type of ['php', 'js', 'templates', 'xml']) {
        fs.mkdirSync(`${root}/coverage/${type}`, {recursive: true});
        fs.writeFileSync(`${root}/coverage/${type}/index.html`, '<html></html>');
    }
    fs.writeFileSync(`${root}/README.md`, '<!-- coverage-badges:start -->\n<!-- coverage-badges:end -->');
    fs.writeFileSync(`${root}/coverage/.active-run`, 'fixture');
    const totals = {covered, total: 1, percent};
    // One eligible unit per metric, covered or not, in the shapes the collectors export.
    const areas = {frontend: {status: 'eligible', hits: covered}, adminhtml: {status: 'unsupported', hits: 0}};
    // Since the XML report counts lines in every file, the di.xml line is part of the XML line total.
    writeXmlJson(path.join(root, 'coverage/xml/coverage.json'), {run: 'fixture', covered: covered * 2, total: 2, percent, complete: true, sourcesUnchanged: true, collectorErrors: [],
        observers: totals, plugins: totals, preferences: totals, virtualTypes: totals, arguments: totals, lifecycles: totals, warnings: [],
        files: [{path: 'app/code/Acme/Shop/etc/config.xml', family: 'config', declarations: [{id: 'config-1', family: 'config', startLine: 5, endLine: 5}],
            lines: {5: {hits: covered, state: covered ? 'covered' : 'uncovered'}, 6: {hits: 0, state: 'unmeasured'}}},
        {path: 'app/code/Acme/Shop/etc/di.xml', family: 'plugins', lines: {3: {hits: covered, state: covered ? 'covered' : 'uncovered'}},
            declarations: ['events', 'plugins', 'preferences', 'virtual-types', 'arguments', 'lifecycles'].map((family, index) =>
                ({id: `declaration-${index}`, family, startLine: 3 + index, endLine: 4 + index, areas}))}]});
    json('coverage/php/line-coverage.json', {'app/code/Acme/Shop/Model/Cart.php': {12: covered}});
    const script = '/workspace/src/app/code/Acme/Shop/view/frontend/web/js/cart.js';
    const location = {start: {line: 2, column: 0}, end: {line: 3, column: 1}};
    json('coverage/javascript-scope.json', {run: 'fixture', included: [{path: 'app/code/Acme/Shop/view/frontend/web/js/cart.js', coveragePath: script}]});
    json('coverage/js/coverage-final.json', {[script]: {path: script, statementMap: {0: location}, s: {0: covered * 7},
        fnMap: {0: {name: 'add', loc: location}}, f: {0: covered}, branchMap: {0: {locations: [location]}}, b: {0: [covered]}}});
    json('coverage/run.json', {id: 'fixture', runner, sources: {}});
    json('coverage/php/coverage-summary.json', {run: 'fixture', covered, total: 1, percent, requests: [{uri: '/customer/', method: 'GET'}], commands: []});
    json('coverage/js/coverage-summary.json', {total: Object.fromEntries(['statements', 'functions', 'branches', 'lines'].map(name => [name, {covered, total: 1, pct: percent}]))});
    json('coverage/templates/coverage-summary.json', {schemaVersion: 2, records: 1, lines: {covered, total: 1, percent}, summary: {covered, eligible: 1, percent},
        statements: totals, functions: totals, branches: totals,
        templates: [{path: 'app/code/Acme/Shop/view/frontend/templates/cart.phtml', kind: 'browser-phtml', instrumented: true,
            status: covered ? 'observed' : 'unobserved', observations: covered * 3, lineHits: {4: {hits: covered * 2}},
            statements: [{id: 'binding:1', start: {line: 4}, hits: covered * 2}], functions: [{id: 'script:1:f:0', hits: covered}],
            branches: [{id: 'script:1:b:0', hits: covered}], scripts: []}]});
    json(`coverage/${runner}-results.json`, {run: 'fixture', totalTests: 1, totalPassed: 1, totalFailed: 0, totalPending: 0, totalSkipped: 0});
    json('coverage/cli-results.json', {run: 'fixture', totalTests: 0, totalPassed: 0, totalFailed: 0, totalPending: 0, totalSkipped: 0, commands: 0});
    return {root, json, run: (args = []) => spawnSync(process.execPath, [projectFile('bin/finalize.cjs'), ...args], {cwd: root, encoding: 'utf8'})};
}

for (const covered of [0, 1]) test(`publishes valid ${covered * 100}% coverage without demo routes or files`, t => {
    const fixture = reports(t, covered);
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(`${fixture.root}/coverage/index.html`));
    assert.equal(JSON.parse(fs.readFileSync(`${fixture.root}/coverage/summary.json`)).metrics.php.percent, covered * 100);
});

test('a report from a different run cannot publish passing badges', t => {
    const fixture = reports(t, 1);
    fs.writeFileSync(`${fixture.root}/coverage/run.json`, JSON.stringify({id: 'new-run', sources: {}}));
    assert.notEqual(fixture.run().status, 0);
    assert.ok(!fs.existsSync(`${fixture.root}/coverage/summary.json`));
});

test('the main report uses N/A when XML has no measured lines', t => {
    const fixture = reports(t, 1);
    const file = 'coverage/xml/coverage.json';
    const xml = JSON.parse(fs.readFileSync(path.join(fixture.root, file)));
    fixture.json(file, {...xml, covered: 0, total: 0, percent: null});
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(path.join(fixture.root, 'coverage/index.html'), 'utf8');
    assert.match(html, /href="xml\/index.html"[^>]*>XML configuration lines[\s\S]*?<td><strong>N\/A<\/strong><\/td>/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.root, 'coverage/summary.json'))).metrics.xml.percent, null);
});

test('unsupported template directives remain visible when scripts and browser tests pass', t => {
    const fixture = reports(t, 1);
    const file = `${fixture.root}/coverage/templates/coverage-summary.json`;
    const templates = JSON.parse(fs.readFileSync(file));
    templates.templates.push({path: 'app/design/frontend/Example/theme/image.phtml', kind: 'browser-phtml', instrumented: false,
        unsupportedDirectives: ['Dynamic event name at line 12']});
    templates.scripts = {instrumented: 1, unsupported: [], generated: []};
    fs.writeFileSync(file, JSON.stringify(templates));
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(`${fixture.root}/coverage/index.html`, 'utf8'), /Template measurement is partial.*1 unsupported directives/s);
    assert.deepEqual(JSON.parse(fs.readFileSync(`${fixture.root}/coverage/summary.json`)).templateLimitations.directives,
        [{path: templates.templates[1].path, reason: 'Dynamic event name at line 12'}]);
});

for (const runner of ['cypress', 'playwright']) {
    for (const readme of ['<!-- coverage-badges:start -->\nprevious results\n<!-- coverage-badges:end -->', '# No badge markers\r\n']) {
        test(`${runner}: default finalization preserves README and generates badges`, t => {
            const fixture = reports(t, 1, runner);
            const file = path.join(fixture.root, 'README.md');
            fs.writeFileSync(file, readme);
            const result = fixture.run();
            assert.equal(result.status, 0, result.stderr);
            assert.equal(fs.readFileSync(file, 'utf8'), readme);
            for (const type of [runner, 'php', 'js', 'templates']) {
                assert.match(fs.readFileSync(`${fixture.root}/coverage/badges/${type}.svg`, 'utf8'), /<svg/);
            }
        });
    }
    test(`${runner}: opt-in finalization replaces pending README with current results`, t => {
        const fixture = reports(t, 1, runner);
        const file = path.join(fixture.root, 'README.md');
        fs.writeFileSync(file, '<!-- coverage-badges:start -->\nCoverage has not completed for the current run.\n<!-- coverage-badges:end -->');
        const result = fixture.run(['--update-readme']);
        assert.equal(result.status, 0, result.stderr);
        const readme = fs.readFileSync(file, 'utf8');
        assert.match(readme, new RegExp(`coverage/badges/${runner}\\.svg`));
        assert.match(readme, /Full .* run: `fixture`/);
        assert.doesNotMatch(readme, /Coverage has not completed/);
    });
    for (const counts of [{totalPassed: 0, totalFailed: 1}, {totalPassed: 0, totalSkipped: 1}, {totalPassed: 0, totalPending: 1}]) {
        test(`${runner}: unsuccessful tests leave opted-in README pending without badges`, t => {
            const fixture = reports(t, 1, runner);
            const file = path.join(fixture.root, 'README.md');
            const pending = '<!-- coverage-badges:start -->\nCoverage has not completed for the current run.\n<!-- coverage-badges:end -->';
            fs.writeFileSync(file, pending);
            const resultsFile = `${fixture.root}/coverage/${runner}-results.json`;
            const results = JSON.parse(fs.readFileSync(resultsFile));
            fs.writeFileSync(resultsFile, JSON.stringify({...results, ...counts}));
            assert.notEqual(fixture.run(['--update-readme']).status, 0);
            assert.equal(fs.readFileSync(file, 'utf8'), pending);
            assert.ok(!fs.existsSync(`${fixture.root}/coverage/badges`));
        });
    }
}

for (const runner of ['cypress', 'playwright']) {
    for (const updateReadme of [false, true]) {
        test(`${runner}: empty executable templates publish N/A (update README: ${updateReadme})`, t => {
            const fixture = reports(t, 1, runner);
            const file = `${fixture.root}/coverage/templates/coverage-summary.json`;
            const templates = JSON.parse(fs.readFileSync(file));
            templates.lines = {total: 0, covered: 0, uncovered: 0, percent: null};
            templates.summary = {covered: 4, eligible: 4, percent: 100};
            templates.statements = templates.functions = templates.branches = {total: 0, covered: 0};
            templates.templates = [1, 2, 3, 4].map(index => ({path: `app/code/Acme/Shop/view/frontend/templates/static-${index}.phtml`, kind: 'browser-phtml',
                instrumented: true, status: 'observed', observations: 1, lineHits: {}, statements: [], functions: [], branches: [], scripts: []}));
            fs.writeFileSync(file, JSON.stringify(templates));
            const result = fixture.run(updateReadme ? ['--update-readme'] : []);
            assert.equal(result.status, 0, result.stderr);
            const html = fs.readFileSync(`${fixture.root}/coverage/index.html`, 'utf8');
            assert.match(html, /<strong>N\/A<\/strong><\/td>/);
            assert.match(html, /DOM presence: 4\/4 templates \(100%\)/);
            assert.doesNotMatch(html, /N\/A%|width:null|width:N\/A/);
            assert.match(fs.readFileSync(`${fixture.root}/coverage/badges/templates.svg`, 'utf8'), /Template executable lines: N\/A/);
            assert.equal(JSON.parse(fs.readFileSync(`${fixture.root}/coverage/summary.json`)).metrics.templates.percent, null);
            assert.deepEqual(JSON.parse(fs.readFileSync(file)), templates);
            assert.ok(!fs.existsSync(`${fixture.root}/coverage/.active-run`));
            if (updateReadme) assert.match(fs.readFileSync(`${fixture.root}/README.md`, 'utf8'), /Template executable lines: N\/A\]/);
        });
    }
}
test('CLI results require current coverage for every command and a fully passing suite', t => {
    const fixture = reports(t, 1);
    const file = 'coverage/cli-results.json';
    const results = {run: 'fixture', totalTests: 1, totalPassed: 1, totalFailed: 0, totalPending: 0, totalSkipped: 0, commands: 0};
    for (const change of [{run: 'stale'}, {totalPending: 1}, {totalSkipped: 1}, {totalFailed: 1}, {commands: 1}]) {
        fixture.json(file, {...results, ...change});
        assert.notEqual(fixture.run().status, 0);
        assert.ok(!fs.existsSync(`${fixture.root}/coverage/index.html`) ||
            !fs.readFileSync(`${fixture.root}/coverage/index.html`, 'utf8').includes('CLI passed'));
    }
});

test('a run without mageLensValidateHtml invocations is shown as not audited', t => {
    const fixture = reports(t, 1);
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(`${fixture.root}/coverage/index.html`, 'utf8');
    assert.match(html, /<caption>Reports<\/caption>/);
    assert.match(html, /HTML validation<small>.*<td colspan="2">Not run<small>No test called mageLensValidateHtml, so no page was audited\./s);
    assert.doesNotMatch(html, /html-validation\/index\.html|0 errors/);
    assert.ok(!fs.existsSync(`${fixture.root}/coverage/html-validation`));
    assert.deepEqual(JSON.parse(fs.readFileSync(`${fixture.root}/coverage/summary.json`)).htmlValidation,
        {audits: 0, pages: 0, errors: 0, warnings: 0, notValidated: 0});
});

test('mageLensValidateHtml captures are validated into a separate Reports section with their own report', t => {
    const fixture = reports(t, 1);
    const capture = {run: 'fixture', runner: 'cypress', spec: 'cypress/e2e/pages.cy.js', test: 'audits pages', status: 200, contentType: 'text/html'};
    const document = body => `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Page</title></head><body>\n${body}\n</body></html>`;
    fs.mkdirSync(`${fixture.root}/coverage/raw/html-validation`, {recursive: true});
    fixture.json('coverage/raw/html-validation/1.json', {...capture, url: 'https://shop.test/clean', html: document('<p>Fine</p>')});
    fixture.json('coverage/raw/html-validation/2.json', {...capture, url: 'https://shop.test/broken', html: document('<p id="a">One</p><p id="a">Two</p>')});
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(`${fixture.root}/coverage/index.html`, 'utf8');
    assert.match(html, /<a href="html-validation\/index\.html">HTML validation/);
    assert.match(html, /<td>2 audits<small>2 pages<\/small><\/td>\s*<td>1 errors<small>0 warnings<\/small><\/td>/);
    assert.doesNotMatch(html, /Not run|not validated/);
    const report = fs.readFileSync(`${fixture.root}/coverage/html-validation/index.html`, 'utf8');
    assert.match(report, /<code>https:\/\/shop\.test\/clean<\/code>.*No issues found\..*<code>https:\/\/shop\.test\/broken<\/code>.*Duplicate ID &quot;a&quot;.*3:25/s);
    assert.deepEqual(JSON.parse(fs.readFileSync(`${fixture.root}/coverage/summary.json`)).htmlValidation,
        {audits: 2, pages: 2, errors: 1, warnings: 0, notValidated: 0});
});

test('validation records from another run block publication', t => {
    const fixture = reports(t, 1);
    fs.mkdirSync(`${fixture.root}/coverage/raw/html-validation`, {recursive: true});
    fixture.json('coverage/raw/html-validation/1.json', {run: 'stale', url: '/', status: 200, contentType: 'text/html', html: ''});
    assert.notEqual(fixture.run().status, 0);
    assert.ok(!fs.existsSync(`${fixture.root}/coverage/index.html`));
    assert.ok(!fs.existsSync(`${fixture.root}/coverage/summary.json`));
});

test('the coverage database is written only when the run asks for it', t => {
    const fixture = reports(t, 1);
    assert.equal(fixture.run().status, 0);
    assert.deepEqual(fs.readdirSync(`${fixture.root}/coverage`).filter(file => /sqlite|schema/.test(file)), []);
    assert.equal(fixture.run(['--include-machine-report']).status, 0);
    assert.deepEqual(fs.readdirSync(`${fixture.root}/coverage`).filter(file => /sqlite|schema/.test(file)), ['report.sqlite', 'schema.sql']);
});

// coverage/attribution/ for the reports() fixture: two attempts and shared setup.
function attribution(fixture, change = files => files) {
    const attempt = (id, test, outcome) => ({run: 'fixture', id, runner: 'cypress', spec: 'cypress/e2e/cart.cy.js', test: ['cart', test], retry: 0,
        project: null, worker: null, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', outcome});
    const di = 'app/code/Acme/Shop/etc/di.xml';
    const files = change({
        php: {'app/code/Acme/Shop/Model/Cart.php': {12: {0: 1, unattributed: 1}}},
        javascript: {'app/code/Acme/Shop/view/frontend/web/js/cart.js': {'s:0': {0: 5, 1: 2}, 'f:0': {1: 1}, 'b:0:0': {0: 1}}},
        templates: {'app/code/Acme/Shop/view/frontend/templates/cart.phtml': {'binding:1': {0: 2}, 'script:1:f:0': {1: 1}, 'script:1:b:0': {unattributed: 1}}},
        xml: {'app/code/Acme/Shop/etc/config.xml': {'config-1': {0: 1}},
            [di]: Object.fromEntries([0, 1, 2, 3, 4, 5].map(index => [`declaration-${index}@frontend`, {1: 1}]))}
    });
    fixture.json('coverage/attribution/index.json', {schemaVersion: 1, run: 'fixture', attempts: [attempt('a'.repeat(32), 'adds', 'passed'), attempt('b'.repeat(32), 'removes', 'failed')]});
    for (const [name, data] of Object.entries(files)) fixture.json(`coverage/attribution/${name}.json`, {schemaVersion: 1, run: 'fixture', files: data});
}

test('the coverage database loads test attribution with each collector\'s hit semantics', t => {
    const fixture = reports(t, 1);
    fs.mkdirSync(`${fixture.root}/coverage/attribution`);
    attribution(fixture);
    assert.equal(fixture.run(['--include-machine-report']).status, 0);
    const query = database(t, fixture);
    assert.deepEqual(query("SELECT status FROM manifest WHERE collector = 'test-attribution'"), [{status: 'collected'}]);
    assert.deepEqual(query('SELECT attempt_id, attempt_key, test_name, outcome FROM attempts'), [
        {attempt_id: 0, attempt_key: 'a'.repeat(32), test_name: 'cart › adds', outcome: 'passed'},
        {attempt_id: 1, attempt_key: 'b'.repeat(32), test_name: 'cart › removes', outcome: 'failed'}]);
    assert.deepEqual(query("SELECT source_type, metric, record_key, test_name, hit_count FROM record_attempts WHERE file_path LIKE '%Cart.php' OR file_path LIKE '%.js' ORDER BY source_type, metric, test_name"), [
        {source_type: 'js', metric: 'branches', record_key: '0:0', test_name: 'cart › adds', hit_count: 1},
        {source_type: 'js', metric: 'functions', record_key: '0', test_name: 'cart › removes', hit_count: 1},
        {source_type: 'js', metric: 'statements', record_key: '0', test_name: 'cart › adds', hit_count: 5},
        {source_type: 'js', metric: 'statements', record_key: '0', test_name: 'cart › removes', hit_count: 2},
        {source_type: 'php', metric: 'lines', record_key: '12', test_name: 'cart › adds', hit_count: null}]);
    assert.deepEqual(query('SELECT r.source_type, r.metric, r.record_key, u.hit_count FROM unattributed_hits u JOIN records r USING (record_id) ORDER BY r.source_type'), [
        {source_type: 'php', metric: 'lines', record_key: '12', hit_count: null},
        {source_type: 'template', metric: 'branches', record_key: 'script:1:b:0', hit_count: 1}]);
    // di.xml line 3 is owned through the observer declaration that starts there.
    assert.deepEqual(query("SELECT metric, record_key FROM record_attempts WHERE source_type = 'xml' ORDER BY metric, record_key"), [
        'arguments', 'lifecycles', 'lines', 'lines', 'observers', 'plugins', 'preferences', 'virtual-types'].map((metric, index) =>
        ({metric, record_key: metric === 'lines' ? ['3', '5'][index - 2] : `declaration-${['observers', 'plugins', 'preferences', 'virtual-types', 'arguments', 'lifecycles'].indexOf(metric)}@frontend`})));
});

test('XML attribution owns every line a declaration spans and adds counts of declarations sharing a line', t => {
    const fixture = reports(t, 1);
    const xmlFile = `${fixture.root}/coverage/xml/coverage.json`;
    const xml = JSON.parse(fs.readFileSync(xmlFile, 'utf8'));
    // config.xml line 5 is shared by two config declarations; events.xml has an observer spanning lines 9-10.
    xml.files[0].declarations.push({id: 'config-2', family: 'config', startLine: 5, endLine: 5});
    xml.files.push({path: 'app/code/Acme/Shop/etc/events.xml', family: 'events', lines: {9: {hits: 3, state: 'covered'}, 10: {hits: 3, state: 'covered'}},
        declarations: [{id: 'observer-1', family: 'events', startLine: 9, endLine: 10, areas: {frontend: {status: 'eligible', hits: 3}}}]});
    Object.assign(xml, {covered: 4, total: 4, observers: {covered: 2, total: 2}});
    fs.writeFileSync(xmlFile, JSON.stringify(xml));
    fs.mkdirSync(`${fixture.root}/coverage/attribution`);
    attribution(fixture, files => {
        files.xml['app/code/Acme/Shop/etc/config.xml'] = {'config-1': {0: 1}, 'config-2': {0: 2, unattributed: 1}};
        files.xml['app/code/Acme/Shop/etc/events.xml'] = {'observer-1@frontend': {1: 2, unattributed: 1}};
        return files;
    });
    const result = fixture.run(['--include-machine-report']);
    assert.equal(result.status, 0, result.stderr);
    const query = database(t, fixture);
    assert.deepEqual(query(`SELECT r.file_path, r.metric, r.record_key, a.attempt_id, a.hit_count FROM attempt_hits a JOIN records r USING (record_id)
        WHERE r.file_path NOT LIKE '%di.xml' AND r.source_type = 'xml' ORDER BY 1, 2, 3`), [
        {file_path: 'app/code/Acme/Shop/etc/config.xml', metric: 'lines', record_key: '5', attempt_id: 0, hit_count: 3},
        {file_path: 'app/code/Acme/Shop/etc/events.xml', metric: 'lines', record_key: '10', attempt_id: 1, hit_count: 2},
        {file_path: 'app/code/Acme/Shop/etc/events.xml', metric: 'lines', record_key: '9', attempt_id: 1, hit_count: 2},
        {file_path: 'app/code/Acme/Shop/etc/events.xml', metric: 'observers', record_key: 'observer-1@frontend', attempt_id: 1, hit_count: 2}]);
    assert.deepEqual(query(`SELECT r.file_path, r.record_key, u.hit_count FROM unattributed_hits u JOIN records r USING (record_id)
        WHERE r.source_type = 'xml' ORDER BY 1, 2`).map(row => [row.file_path.split('/').at(-1), row.record_key, row.hit_count]),
        [['config.xml', '5', 1], ['events.xml', '10', 1], ['events.xml', '9', 1], ['events.xml', 'observer-1@frontend', 1]]);
});

test('layout declarations and effect-measured declarations load like the XML report counts them', t => {
    const fixture = reports(t, 1);
    const xmlFile = `${fixture.root}/coverage/xml/coverage.json`;
    const xml = JSON.parse(fs.readFileSync(xmlFile, 'utf8'));
    // Layout counts per declaration and on its lines; an ACL resource counts on its lines, observed per area.
    xml.files.push({path: 'app/code/Acme/Shop/view/frontend/layout/cart.xml', family: 'layout', lines: {4: {hits: 2, state: 'covered'}},
        declarations: [{id: 'block-1', family: 'layout', startLine: 4, endLine: 4, state: 'covered', hits: 2},
            {id: 'block-2', family: 'layout', startLine: 5, endLine: 5, state: 'unmeasured', hits: 0}]},
        {path: 'app/code/Acme/Shop/etc/acl.xml', family: 'acl', lines: {9: {hits: 3, state: 'covered'}},
            declarations: [{id: 'resource-1', family: 'acl', effects: ['acl-check'], startLine: 9, endLine: 9, hits: 3}]});
    Object.assign(xml, {covered: 4, total: 4, layout: {covered: 1, total: 1}});
    fs.writeFileSync(xmlFile, JSON.stringify(xml));
    fs.mkdirSync(`${fixture.root}/coverage/attribution`);
    attribution(fixture, files => {
        files.xml['app/code/Acme/Shop/view/frontend/layout/cart.xml'] = {'block-1': {0: 2}};
        files.xml['app/code/Acme/Shop/etc/acl.xml'] = {'resource-1@adminhtml': {1: 3}};
        return files;
    });
    const result = fixture.run(['--include-machine-report']);
    assert.equal(result.status, 0, result.stderr);
    const query = database(t, fixture);
    assert.deepEqual(query("SELECT file_path, metric, record_key FROM records WHERE file_path LIKE '%cart.xml' OR file_path LIKE '%acl.xml' ORDER BY 1, 2"), [
        {file_path: 'app/code/Acme/Shop/etc/acl.xml', metric: 'lines', record_key: '9'},
        {file_path: 'app/code/Acme/Shop/view/frontend/layout/cart.xml', metric: 'layout', record_key: 'block-1'},
        {file_path: 'app/code/Acme/Shop/view/frontend/layout/cart.xml', metric: 'lines', record_key: '4'}]);
    assert.deepEqual(query("SELECT file_path, metric, record_key, test_name, hit_count FROM record_attempts WHERE file_path LIKE '%cart.xml' OR file_path LIKE '%acl.xml' ORDER BY 1, 2"), [
        {file_path: 'app/code/Acme/Shop/etc/acl.xml', metric: 'lines', record_key: '9', test_name: 'cart › removes', hit_count: 3},
        {file_path: 'app/code/Acme/Shop/view/frontend/layout/cart.xml', metric: 'layout', record_key: 'block-1', test_name: 'cart › adds', hit_count: 2},
        {file_path: 'app/code/Acme/Shop/view/frontend/layout/cart.xml', metric: 'lines', record_key: '4', test_name: 'cart › adds', hit_count: 2}]);
});

test('attribution of another run cannot be loaded', t => {
    const fixture = reports(t, 1);
    fs.mkdirSync(`${fixture.root}/coverage/attribution`);
    attribution(fixture);
    const index = JSON.parse(fs.readFileSync(`${fixture.root}/coverage/attribution/index.json`, 'utf8'));
    fixture.json('coverage/attribution/index.json', {...index, run: 'previous'});
    assert.match(fixture.run(['--include-machine-report']).stderr, /Test attribution belongs to another run/);
    fixture.json('coverage/attribution/index.json', index);
    fixture.json('coverage/attribution/xml.json', {schemaVersion: 1, run: 'previous', files: {}});
    assert.match(fixture.run(['--include-machine-report']).stderr, /xml attribution belongs to another run/);
});

test('attribution that does not match the database records blocks publication', t => {
    for (const [change, error] of [
        [files => { files.php['app/code/Acme/Shop/Model/Cart.php'][13] = {0: 1}; return files; }, /php unit without a covered record/],
        [files => { delete files.templates['app/code/Acme/Shop/view/frontend/templates/cart.phtml']['binding:1']; return files; }, /Covered unit without attribution/]
    ]) {
        const fixture = reports(t, 1);
        fs.mkdirSync(`${fixture.root}/coverage/attribution`);
        attribution(fixture, change);
        const result = fixture.run(['--include-machine-report']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, error);
        assert.ok(!fs.existsSync(`${fixture.root}/coverage/report.sqlite`));
    }
});

test('an attributed unit that the report shows as uncovered blocks publication', t => {
    const fixture = reports(t, 0);
    fs.mkdirSync(`${fixture.root}/coverage/attribution`);
    attribution(fixture, () => ({php: {'app/code/Acme/Shop/Model/Cart.php': {12: {0: 1}}}, javascript: {}, templates: {}, xml: {}}));
    const result = fixture.run(['--include-machine-report']);
    assert.match(result.stderr, /report shows as uncovered/);
});

function database(t, fixture) {
    const connection = new DatabaseSync(`${fixture.root}/coverage/report.sqlite`, {readOnly: true});
    t.after(() => connection.close());
    return sql => connection.prepare(sql).all().map(row => ({...row}));
}

test('the coverage database stores every eligible unit once and only positive observations', t => {
    const fixture = reports(t, 1);
    assert.equal(fixture.run(['--include-machine-report']).status, 0);
    const query = database(t, fixture);
    assert.deepEqual(query('SELECT record_type, source_type, metric, record_key, file_path, module_name, start_line, end_line, hit_count FROM records LEFT JOIN hits USING (record_id) ORDER BY source_type, metric, record_key'), [
        ['branch', 'js', 'branches', '0:0', 'app/code/Acme/Shop/view/frontend/web/js/cart.js', 'Acme_Shop', 2, 3, 1],
        ['function', 'js', 'functions', '0', 'app/code/Acme/Shop/view/frontend/web/js/cart.js', 'Acme_Shop', 2, 3, 1],
        ['statement', 'js', 'statements', '0', 'app/code/Acme/Shop/view/frontend/web/js/cart.js', 'Acme_Shop', 2, 3, 7],
        ['line', 'php', 'lines', '12', 'app/code/Acme/Shop/Model/Cart.php', 'Acme_Shop', 12, 12, null],
        ['branch', 'template', 'branches', 'script:1:b:0', 'app/code/Acme/Shop/view/frontend/templates/cart.phtml', 'Acme_Shop', null, null, 1],
        ['template', 'template', 'dom-presence', 'template', 'app/code/Acme/Shop/view/frontend/templates/cart.phtml', 'Acme_Shop', null, null, 3],
        ['line', 'template', 'executable-lines', '4', 'app/code/Acme/Shop/view/frontend/templates/cart.phtml', 'Acme_Shop', 4, 4, 2],
        ['function', 'template', 'functions', 'script:1:f:0', 'app/code/Acme/Shop/view/frontend/templates/cart.phtml', 'Acme_Shop', null, null, 1],
        ['statement', 'template', 'statements', 'binding:1', 'app/code/Acme/Shop/view/frontend/templates/cart.phtml', 'Acme_Shop', 4, 4, 2],
        ['declaration', 'xml', 'arguments', 'declaration-4@frontend', 'app/code/Acme/Shop/etc/di.xml', 'Acme_Shop', 7, 8, 1],
        ['declaration', 'xml', 'lifecycles', 'declaration-5@frontend', 'app/code/Acme/Shop/etc/di.xml', 'Acme_Shop', 8, 9, 1],
        ['line', 'xml', 'lines', '3', 'app/code/Acme/Shop/etc/di.xml', 'Acme_Shop', 3, 3, 1],
        ['line', 'xml', 'lines', '5', 'app/code/Acme/Shop/etc/config.xml', 'Acme_Shop', 5, 5, 1],
        ['declaration', 'xml', 'observers', 'declaration-0@frontend', 'app/code/Acme/Shop/etc/di.xml', 'Acme_Shop', 3, 4, 1],
        ['declaration', 'xml', 'plugins', 'declaration-1@frontend', 'app/code/Acme/Shop/etc/di.xml', 'Acme_Shop', 4, 5, 1],
        ['declaration', 'xml', 'preferences', 'declaration-2@frontend', 'app/code/Acme/Shop/etc/di.xml', 'Acme_Shop', 5, 6, 1],
        ['declaration', 'xml', 'virtual-types', 'declaration-3@frontend', 'app/code/Acme/Shop/etc/di.xml', 'Acme_Shop', 6, 7, 1]
    ].map(([record_type, source_type, metric, record_key, file_path, module_name, start_line, end_line, hit_count]) =>
        ({record_type, source_type, metric, record_key, file_path, module_name, start_line, end_line, hit_count})));
    assert.deepEqual(query('SELECT COUNT(*) AS uncovered FROM uncovered_records'), [{uncovered: 0}]);
    assert.deepEqual(query('SELECT COUNT(*) AS rows FROM attempts UNION ALL SELECT COUNT(*) FROM attempt_hits UNION ALL SELECT COUNT(*) FROM unattributed_hits'),
        [{rows: 0}, {rows: 0}, {rows: 0}]);
});

test('uncovered units stay in the coverage database as records without hits', t => {
    const fixture = reports(t, 0);
    assert.equal(fixture.run(['--include-machine-report']).status, 0);
    const query = database(t, fixture);
    assert.deepEqual(query('SELECT COUNT(*) AS records FROM records UNION ALL SELECT COUNT(*) FROM hits UNION ALL SELECT COUNT(*) FROM uncovered_records'),
        [{records: 17}, {records: 0}, {records: 17}]);
    // One eligible unit per metric, except XML lines: config.xml and di.xml each have one.
    assert.ok(query('SELECT source_type, metric, total, covered, percent FROM metric_totals')
        .every(row => row.total === (row.source_type === 'xml' && row.metric === 'lines' ? 2 : 1) && row.covered === 0 && row.percent === 0));
    assert.deepEqual(query("SELECT file_path, start_line, end_line FROM uncovered_records WHERE source_type = 'php'"),
        [{file_path: 'app/code/Acme/Shop/Model/Cart.php', start_line: 12, end_line: 12}]);
    assert.deepEqual(query("SELECT collector, status FROM manifest WHERE collector = 'php'"), [{collector: 'php', status: 'collected'}],
        'Collected but uncovered is not the same as not collected');
});

test('the manifest table tells collected data from data that is not collected', t => {
    const fixture = reports(t, 1);
    const file = `${fixture.root}/coverage/templates/coverage-summary.json`;
    const templates = JSON.parse(fs.readFileSync(file));
    templates.templates.push({path: 'app/design/frontend/Acme/theme/Magento_Catalog/templates/image.phtml', kind: 'browser-phtml', instrumented: false,
        unsupportedDirectives: ['first', 'second']});
    fs.writeFileSync(file, JSON.stringify(templates));
    assert.equal(fixture.run(['--include-machine-report']).status, 0);
    const query = database(t, fixture);
    const summary = JSON.parse(fs.readFileSync(`${fixture.root}/coverage/summary.json`));
    const rows = query('SELECT * FROM manifest ORDER BY collector');
    assert.deepEqual(rows.map(row => [row.collector, row.status]),
        [['js', 'collected'], ['php', 'collected'], ['template', 'collected'], ['test-attribution', 'not_collected'], ['xml', 'collected']]);
    assert.deepEqual(query("SELECT DISTINCT source_type FROM records WHERE source_type NOT IN (SELECT collector FROM manifest)"), []);
    for (const row of rows) {
        assert.deepEqual([row.schema_version, row.run_id, row.generated_at, row.commit_sha], [1, 'fixture', summary.generatedAt, null], row.collector);
        assert.ok(row.scope, row.collector);
    }
    const templatesRow = rows.find(row => row.collector === 'template');
    assert.deepEqual(JSON.parse(templatesRow.limitations).map(limitation => [limitation.id, limitation.count]), [['unsupported-directives', 2]]);
    assert.deepEqual(JSON.parse(templatesRow.export_paths), ['templates/coverage-summary.json']);
    assert.deepEqual(JSON.parse(rows.find(row => row.collector === 'php').limitations), []);
    assert.deepEqual(query("SELECT COUNT(*) AS records FROM records WHERE file_path LIKE '%image.phtml'"), [{records: 0}], 'Unsupported templates have no records');
});

test('a template export without observation records is an inventory, not a measurement', t => {
    const fixture = reports(t, 0);
    const file = `${fixture.root}/coverage/templates/coverage-summary.json`;
    fs.writeFileSync(file, JSON.stringify({...JSON.parse(fs.readFileSync(file)), records: 0}));
    assert.equal(fixture.run(['--include-machine-report']).status, 0);
    const query = database(t, fixture);
    assert.deepEqual(query('SELECT collector, status FROM manifest ORDER BY collector').map(row => [row.collector, row.status]),
        [['js', 'collected'], ['php', 'collected'], ['template', 'inventory_only'], ['test-attribution', 'not_collected'], ['xml', 'collected']]);
    assert.deepEqual(query("SELECT COUNT(*) AS records FROM records WHERE source_type = 'template'"), [{records: 5}], 'The inventory stays queryable');
    assert.deepEqual(query("SELECT COUNT(*) AS hits FROM hits JOIN records USING (record_id) WHERE source_type = 'template'"), [{hits: 0}]);
});

test('Alpine directives that can miss evaluations are listed as a template limitation', t => {
    const fixture = reports(t, 1);
    const file = `${fixture.root}/coverage/templates/coverage-summary.json`;
    const templates = JSON.parse(fs.readFileSync(file));
    templates.templates[0].measurementLimitations = ['Coverage for x-model can miss evaluations when markers are added after Alpine first binds the directive.'];
    fs.writeFileSync(file, JSON.stringify(templates));
    assert.equal(fixture.run(['--include-machine-report']).status, 0);
    const [row] = database(t, fixture)("SELECT limitations FROM manifest WHERE collector = 'template'");
    assert.deepEqual(JSON.parse(row.limitations).map(limitation => [limitation.id, limitation.count]), [['alpine-late-markers', 1]]);
});

test('app/code modules are named as registered in etc/module.xml', t => {
    const fixture = reports(t, 1);
    fs.mkdirSync(`${fixture.root}/src/app/code/Acme/Shop/etc`, {recursive: true});
    fs.writeFileSync(`${fixture.root}/src/app/code/Acme/Shop/etc/module.xml`, '<config><module name="Acme_Store"/></config>');
    const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(`${fixture.root}/src/app/code/Acme/Shop/etc/module.xml`)).digest('hex');
    fixture.json('coverage/run.json', {id: 'fixture', runner: 'cypress', sources: {'src/app/code/Acme/Shop/etc/module.xml': hash}});
    const result = fixture.run(['--include-machine-report']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(database(t, fixture)("SELECT DISTINCT module_name FROM records WHERE file_path LIKE 'app/code/%'"), [{module_name: 'Acme_Store'}]);
});

test('database percentages must equal the reported ones, with JavaScript as Istanbul truncates', t => {
    const fixture = reports(t, 1);
    const script = '/workspace/src/app/code/Acme/Shop/view/frontend/web/js/cart.js';
    const location = {start: {line: 2, column: 0}, end: {line: 3, column: 1}};
    const ids = Array.from({length: 20000}, (_, id) => id);
    fixture.json('coverage/js/coverage-final.json', {[script]: {path: script, statementMap: Object.fromEntries(ids.map(id => [id, location])),
        s: Object.fromEntries(ids.map(id => [id, id ? 1 : 0])), fnMap: {0: {name: 'add', loc: location}}, f: {0: 1}, branchMap: {0: {locations: [location]}}, b: {0: [1]}}});
    fixture.json('coverage/php/line-coverage.json', {'app/code/Acme/Shop/Model/Cart.php': Object.fromEntries(ids.map(id => [id + 1, id ? 1 : 0]))});
    fixture.json('coverage/php/coverage-summary.json', {run: 'fixture', covered: 19999, total: 20000, percent: 100, requests: [{uri: '/', method: 'GET'}], commands: []});
    const summary = pct => ({total: {statements: {covered: 19999, total: 20000, pct}, functions: {covered: 1, total: 1, pct: 100}, branches: {covered: 1, total: 1, pct: 100}, lines: {covered: 1, total: 1, pct: 100}}});
    fixture.json('coverage/js/coverage-summary.json', summary(100));
    const result = fixture.run(['--include-machine-report']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Coverage database percentage differs from the js statements report/);
    const percent = require('istanbul-lib-coverage/lib/percent');
    fixture.json('coverage/js/coverage-summary.json', summary(percent(19999, 20000)));
    // Restore the marker of the active run, as a fresh finalization finds it.
    fs.writeFileSync(`${fixture.root}/coverage/.active-run`, 'fixture');
    const retry = fixture.run(['--include-machine-report']);
    assert.equal(retry.status, 0, retry.stderr);
    assert.deepEqual(database(t, fixture)("SELECT source_type, percent FROM metric_totals WHERE metric IN ('statements', 'lines') AND source_type IN ('js', 'php') ORDER BY source_type"),
        [{source_type: 'js', percent: 99.99}, {source_type: 'php', percent: 100}]);
});

test('percentage views compute each source as its report does', () => {
    const istanbul = require('istanbul-lib-coverage/lib/percent');
    // As istanbul-lib-coverage, the template package summary and the XML report's formatPercent.
    const reported = {js: istanbul, template: (covered, total) => Math.round(10000 * covered / total) / 100,
        xml: (covered, total) => Number((covered / total * 100).toFixed(2))};
    const connection = new DatabaseSync(':memory:');
    connection.exec(fs.readFileSync(projectFile('bin/report-schema.sql'), 'utf8'));
    const addRecord = connection.prepare("INSERT INTO records (record_type, source_type, metric, record_key, file_path, module_name) VALUES ('statement', ?, 'statements', ?, ?, ?)");
    const addHit = connection.prepare('INSERT INTO hits (record_id) VALUES (?)');
    const expected = {};
    connection.exec('BEGIN');
    // Small totals, plus pairs where ROUND(x, 2) differs from the report: 19999/20000 for Istanbul
    // and 23/160 for toFixed(2) of a binary fraction.
    const small = Array.from({length: 40}, (_, index) => index + 1).flatMap(total => Array.from({length: total + 1}, (_, covered) => [covered, total]));
    const cases = {js: [...small, [19999, 20000]], template: [...small, [19999, 20000], [23, 160]], xml: [...small, [23, 160], [41, 160]]};
    for (const [source, pairs] of Object.entries(cases)) for (const [covered, total] of pairs) {
        const file = `${source}/${covered}/${total}`;
        expected[file] = reported[source](covered, total);
        for (let key = 0; key < total; key++) {
            const {lastInsertRowid} = addRecord.run(source, String(key), file, file);
            if (key < covered) addHit.run(lastInsertRowid);
        }
    }
    connection.exec('COMMIT');
    for (const view of ['file_totals', 'module_totals']) {
        const column = view === 'file_totals' ? 'file_path' : 'module_name';
        const rows = connection.prepare(`SELECT ${column} AS file, percent FROM ${view}`).all();
        assert.equal(rows.length, Object.keys(expected).length);
        for (const row of rows) assert.equal(row.percent, expected[row.file], `${view} ${row.file}`);
    }
    connection.close();
});

test('the skill query for files no test reached skips partially covered files', t => {
    const fixture = reports(t, 1);
    const script = '/workspace/src/app/code/Acme/Shop/view/frontend/web/js/cart.js';
    const final = JSON.parse(fs.readFileSync(`${fixture.root}/coverage/js/coverage-final.json`));
    final[script].f = {0: 0};
    fixture.json('coverage/js/coverage-final.json', final);
    const summary = JSON.parse(fs.readFileSync(`${fixture.root}/coverage/js/coverage-summary.json`));
    summary.total.functions = {covered: 0, total: 1, pct: 0};
    fixture.json('coverage/js/coverage-summary.json', summary);
    fixture.json('coverage/php/line-coverage.json', {'app/code/Acme/Shop/Model/Cart.php': {12: 1}, 'app/code/Acme/Shop/Model/Order.php': {3: 0}});
    fixture.json('coverage/php/coverage-summary.json', {run: 'fixture', covered: 1, total: 2, percent: 50, requests: [{uri: '/', method: 'GET'}], commands: []});
    const result = fixture.run(['--include-machine-report']);
    assert.equal(result.status, 0, result.stderr);
    const skill = fs.readFileSync(projectFile('.agents/skills/coverage-database/SKILL.md'), 'utf8');
    const sql = skill.match(/Files of a module that no test reached at all:\n\n```sql\n([^`]+)```/)[1].replaceAll('Application_Blog', 'Acme_Shop');
    assert.deepEqual(database(t, fixture)(sql), [{file_path: 'app/code/Acme/Shop/Model/Order.php'}]);
});

test('views total files and modules from counts and keep metrics apart', t => {
    const fixture = reports(t, 1);
    fixture.json('coverage/php/line-coverage.json', {
        'app/code/Acme/Shop/Model/Cart.php': {12: 1, 13: 1, 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1},
        'app/code/Acme/Shop/Model/Order.php': Object.fromEntries(Array.from({length: 90}, (_, line) => [line + 1, 0])),
        'app/design/frontend/Acme/theme/Magento_Theme/templates/header.phtml': {3: 1, 4: 0},
        'vendor/acme/payments/Model/Gateway.php': {8: 0}});
    fixture.json('coverage/php/coverage-summary.json', {run: 'fixture', covered: 11, total: 103, percent: 10.68, requests: [{uri: '/', method: 'GET'}], commands: []});
    assert.equal(fixture.run(['--include-machine-report']).status, 0);
    const query = database(t, fixture);
    assert.deepEqual(query("SELECT module_name, files, total, covered, percent FROM module_totals WHERE source_type = 'php' ORDER BY module_name"), [
        {module_name: 'Acme_Shop', files: 2, total: 100, covered: 10, percent: 10},
        {module_name: 'design/frontend/Acme/theme', files: 1, total: 2, covered: 1, percent: 50},
        {module_name: 'vendor/acme/payments', files: 1, total: 1, covered: 0, percent: 0}]);
    assert.deepEqual(query("SELECT file_path, total, covered, percent FROM file_totals WHERE source_type = 'php' AND module_name = 'Acme_Shop' ORDER BY file_path"), [
        {file_path: 'app/code/Acme/Shop/Model/Cart.php', total: 10, covered: 10, percent: 100},
        {file_path: 'app/code/Acme/Shop/Model/Order.php', total: 90, covered: 0, percent: 0}]);
    assert.deepEqual(query("SELECT total, covered, percent FROM metric_totals WHERE source_type = 'php'"), [{total: 103, covered: 11, percent: 10.68}]);
    assert.deepEqual(query("SELECT DISTINCT metric FROM module_totals WHERE module_name = 'Acme_Shop' AND source_type = 'js' ORDER BY metric"),
        [{metric: 'branches'}, {metric: 'functions'}, {metric: 'statements'}]);
});

test('a coverage database that disagrees with a report blocks publication', t => {
    const fixture = reports(t, 1);
    fixture.json('coverage/php/line-coverage.json', {'app/code/Acme/Shop/Model/Cart.php': {12: 1, 13: 0}});
    const result = fixture.run(['--include-machine-report']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Coverage database differs from the php lines report/);
    assert.deepEqual(fs.readdirSync(`${fixture.root}/coverage`).filter(file => /sqlite|schema|index\.html|summary/.test(file)), []);
});

test('the published schema matches the database and pins version 1', t => {
    const fixture = reports(t, 1);
    assert.equal(fixture.run(['--include-machine-report']).status, 0);
    const query = database(t, fixture);
    const schema = fs.readFileSync(`${fixture.root}/coverage/schema.sql`, 'utf8');
    assert.equal(schema, fs.readFileSync(projectFile('bin/report-schema.sql'), 'utf8'));
    assert.deepEqual(query('PRAGMA user_version'), [{user_version: 1}]);
    // Removing or renaming any of these requires a new schema version.
    const columns = name => query(`SELECT name FROM pragma_table_info('${name}')`).map(row => row.name);
    assert.deepEqual(Object.fromEntries(query("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view') ORDER BY name").map(row => [row.name, columns(row.name)])), {
        file_totals: ['source_type', 'metric', 'module_name', 'file_path', 'total', 'covered', 'percent'],
        hits: ['record_id', 'hit_count'],
        manifest: ['collector', 'schema_version', 'run_id', 'generated_at', 'commit_sha', 'status', 'scope', 'limitations', 'export_paths'],
        metric_totals: ['source_type', 'metric', 'total', 'covered', 'percent'],
        module_totals: ['source_type', 'metric', 'module_name', 'files', 'total', 'covered', 'percent'],
        records: ['record_id', 'record_type', 'source_type', 'metric', 'record_key', 'file_path', 'module_name', 'start_line', 'end_line'],
        attempt_hits: ['attempt_id', 'record_id', 'hit_count'],
        attempts: ['attempt_id', 'attempt_key', 'runner', 'spec', 'title_path', 'test_name', 'retry', 'project', 'started_at', 'finished_at', 'outcome'],
        record_attempts: ['source_type', 'metric', 'module_name', 'file_path', 'start_line', 'end_line', 'record_type', 'record_key',
            'attempt_key', 'runner', 'spec', 'test_name', 'retry', 'outcome', 'hit_count'],
        unattributed_hits: ['record_id', 'hit_count'],
        uncovered_records: ['source_type', 'metric', 'module_name', 'file_path', 'start_line', 'end_line', 'record_type', 'record_key']});
    assert.deepEqual(query("SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(row => row.name),
        ['attempt_hits_by_record', 'records_by_module']);
});

test('the commit is read from a Git checkout without the git command', t => {
    const {commitSha} = require(projectFile('bin/report-database.cjs'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-commit-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const sha = 'a'.repeat(40), packed = 'b'.repeat(40);
    assert.equal(commitSha(root), null);
    fs.mkdirSync(`${root}/.git/refs/heads`, {recursive: true});
    fs.writeFileSync(`${root}/.git/HEAD`, 'ref: refs/heads/main\n');
    fs.writeFileSync(`${root}/.git/packed-refs`, `# pack-refs\n${packed} refs/heads/main\n`);
    assert.equal(commitSha(root), packed);
    fs.writeFileSync(`${root}/.git/refs/heads/main`, sha + '\n');
    assert.equal(commitSha(root), sha);
    fs.writeFileSync(`${root}/.git/HEAD`, packed + '\n');
    assert.equal(commitSha(root), packed);
    // A ref name is data, not a pattern.
    fs.writeFileSync(`${root}/.git/HEAD`, 'ref: refs/heads/fix+c(1)\n');
    fs.writeFileSync(`${root}/.git/packed-refs`, `${sha} refs/heads/fixxc(1)\n${packed} refs/heads/fix+c(1)\n`);
    assert.equal(commitSha(root), packed);
    // A worktree keeps HEAD in its own directory and refs in the common one.
    const worktree = `${root}/worktree`;
    fs.mkdirSync(`${root}/.git/worktrees/feature`, {recursive: true});
    fs.mkdirSync(worktree);
    fs.writeFileSync(`${worktree}/.git`, `gitdir: ${root}/.git/worktrees/feature\n`);
    fs.writeFileSync(`${root}/.git/worktrees/feature/commondir`, '../..\n');
    fs.writeFileSync(`${root}/.git/worktrees/feature/HEAD`, 'ref: refs/heads/main\n');
    assert.equal(commitSha(worktree), sha);
    fs.writeFileSync(`${worktree}/.git`, 'gitdir: /missing/host/path\n');
    assert.equal(commitSha(worktree), null);
});

test('a JavaScript branch without its own location is placed at its branch statement', t => {
    const fixture = reports(t, 1);
    const script = '/workspace/src/app/code/Acme/Shop/view/frontend/web/js/cart.js';
    const location = {start: {line: 2, column: 0}, end: {line: 3, column: 1}};
    const condition = {start: {line: 9, column: 4}, end: {line: 11, column: 5}};
    // Istanbul reports the implicit else of an if statement with an empty location.
    fixture.json('coverage/js/coverage-final.json', {[script]: {path: script, statementMap: {0: location}, s: {0: 1}, fnMap: {0: {name: 'add', loc: location}}, f: {0: 1},
        branchMap: {0: {loc: condition, type: 'if', locations: [condition, {start: {}, end: {}}]}}, b: {0: [1, 0]}}});
    fixture.json('coverage/js/coverage-summary.json', {total: {statements: {covered: 1, total: 1, pct: 100}, functions: {covered: 1, total: 1, pct: 100},
        branches: {covered: 1, total: 2, pct: 50}, lines: {covered: 1, total: 1, pct: 100}}});
    const result = fixture.run(['--include-machine-report']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(database(t, fixture)("SELECT record_key, start_line, end_line FROM uncovered_records WHERE source_type = 'js'"),
        [{record_key: '0:1', start_line: 9, end_line: 11}]);
});
