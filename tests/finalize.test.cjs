// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

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
    json('coverage/xml/coverage.json', {run: 'fixture', covered, total: 1, percent, complete: true, sourcesUnchanged: true, collectorErrors: []});
    json('coverage/run.json', {id: 'fixture', runner, sources: {}});
    json('coverage/php/coverage-summary.json', {run: 'fixture', covered, total: 1, percent, requests: [{uri: '/customer/', method: 'GET'}]});
    json('coverage/js/coverage-summary.json', {total: {statements: {covered, total: 1, pct: percent}}});
    json('coverage/templates/coverage-summary.json', {schemaVersion: 2, lines: {covered, total: 1, percent}, templates: [], summary: {covered, eligible: 1, percent}});
    json(`coverage/${runner}-results.json`, {run: 'fixture', totalTests: 1, totalPassed: 1, totalFailed: 0, totalPending: 0, totalSkipped: 0});
    return {root, run: (args = []) => spawnSync(process.execPath, [path.join(__dirname, '../bin/finalize.cjs'), ...args], {cwd: root, encoding: 'utf8'})};
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

test('unsupported template directives remain visible when scripts and browser tests pass', t => {
    const fixture = reports(t, 1);
    const file = `${fixture.root}/coverage/templates/coverage-summary.json`;
    const templates = JSON.parse(fs.readFileSync(file));
    templates.templates = [{path: 'app/design/frontend/Example/theme/image.phtml', kind: 'browser-phtml',
        unsupportedDirectives: ['Dynamic event name at line 12']}];
    templates.scripts = {instrumented: 1, unsupported: [], generated: []};
    fs.writeFileSync(file, JSON.stringify(templates));
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(`${fixture.root}/coverage/index.html`, 'utf8'), /Template measurement is partial.*1 unsupported directives/s);
    assert.deepEqual(JSON.parse(fs.readFileSync(`${fixture.root}/coverage/summary.json`)).templateLimitations.directives,
        [{path: templates.templates[0].path, reason: 'Dynamic event name at line 12'}]);
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
