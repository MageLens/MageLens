// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function reports(t, covered) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-finalize-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const json = (file, data) => fs.writeFileSync(path.join(root, file), JSON.stringify(data));
    const percent = covered * 100;
    for (const type of ['php', 'js', 'templates']) {
        fs.mkdirSync(`${root}/coverage/${type}`, {recursive: true});
        fs.writeFileSync(`${root}/coverage/${type}/index.html`, '<html></html>');
    }
    fs.writeFileSync(`${root}/README.md`, '<!-- coverage-badges:start -->\n<!-- coverage-badges:end -->');
    fs.writeFileSync(`${root}/coverage/.active-run`, 'fixture');
    json('coverage/run.json', {id: 'fixture', sources: {}});
    json('coverage/php/coverage-summary.json', {run: 'fixture', covered, total: 1, percent, requests: [{uri: '/customer/', method: 'GET'}]});
    json('coverage/js/coverage-summary.json', {total: {statements: {covered, total: 1, pct: percent}}});
    json('coverage/templates/coverage-summary.json', {schemaVersion: 2, lines: {covered, total: 1, percent}, templates: [], summary: {covered, eligible: 1, percent}});
    json('coverage/cypress-results.json', {run: 'fixture', totalTests: 1, totalPassed: 1, totalFailed: 0, totalPending: 0, totalSkipped: 0});
    return {root, run: () => spawnSync(process.execPath, [path.join(__dirname, '../bin/finalize.cjs')], {cwd: root, encoding: 'utf8'})};
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
