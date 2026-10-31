// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {createInstrumenter} = require('istanbul-lib-instrument');
const {prepare} = require('../bin/prepare.cjs');
const projectRoot = path.resolve(__dirname, '..');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-browser-report-'));
    const before = process.cwd();
    process.chdir(root);
    t.after(() => { process.chdir(before); fs.rmSync(root, {recursive: true, force: true}); });
    for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(`${projectRoot}/${file}`, file);
    fs.symlinkSync(path.dirname(path.dirname(require.resolve('nyc/package.json'))), 'node_modules', 'dir');
    fs.writeFileSync('README.md', '<!-- coverage-badges:start -->\n<!-- coverage-badges:end -->');
    const base = 'app/code/Acme/Blog';
    const write = (file, content) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content); };
    write(`src/${base}/etc/module.xml`, '<config><module name="Acme_Blog"/></config>');
    for (const name of ['loaded', 'unvisited']) write(`src/${base}/view/frontend/web/js/${name}.js`, `window.${name} = true;`);
    write(`src/${base}/view/frontend/web/template/example.html`, '<span data-bind="text: title"></span>');
    prepare({themeRoots: []});
    fs.mkdirSync('.nyc_output', {recursive: true});
    return {base, write};
}

function coverage(file) {
    const instrumenter = createInstrumenter();
    instrumenter.instrumentSync('window.example = true;', path.resolve(file));
    return instrumenter.lastFileCoverage();
}

test('real JavaScript reports omit stale Test, Setup, and Cypress records and retain unvisited application files', t => {
    const {base} = fixture(t);
    const context = {window: {}};
    vm.runInNewContext(fs.readFileSync(`.runtime/${base}/view/frontend/web/js/loaded.js`, 'utf8'), context);
    const raw = context.window.__coverage__;
    const baseline = JSON.parse(fs.readFileSync('.runtime/js-baseline.json'));
    const tests = [
        `src/${base}/Test/Cypress/support.js`,
        `src/${base}/Test/Cypress/helpers/navigation.js`,
        `src/${base}/Test/example.cy.js`,
        `src/${base}/Test/Unit/example.js`,
        `src/${base}/Setup/Patch/example.js`,
        `src/${base}/cypress/support/commands.js`,
        'src/app/design/frontend/Acme/shop/Test/example.js',
        'src/app/design/adminhtml/Acme/admin/Setup/example.js',
        'cypress/e2e/example.cy.js'
    ];
    for (const file of tests) {
        raw[path.resolve(file)] = coverage(file);
        baseline[path.resolve(file)] = coverage(file);
    }
    fs.writeFileSync('.runtime/js-baseline.json', JSON.stringify(baseline));
    fs.writeFileSync('.nyc_output/out.json', JSON.stringify(raw));
    execFileSync(process.execPath, [`${projectRoot}/bin/report-browser.cjs`], {encoding: 'utf8'});
    const summary = JSON.parse(fs.readFileSync('coverage/js/coverage-summary.json'));
    const loaded = path.resolve(`src/${base}/view/frontend/web/js/loaded.js`);
    const unvisited = path.resolve(`src/${base}/view/frontend/web/js/unvisited.js`);
    assert.deepEqual(Object.keys(summary).sort(), [loaded, unvisited, 'total'].sort());
    assert.equal(summary.total.statements.total, 2);
    assert.equal(summary.total.statements.covered, 1);
    assert.equal(summary.total.statements.pct, 50);
    assert.equal(summary[unvisited].statements.covered, 0);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync('.nyc_output/out.json'))).sort(), [loaded, unvisited].sort());
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync('coverage/js/coverage-final.json'))).sort(), [loaded, unvisited].sort());

    // Verify nyc's own exclusions also protect reports made directly from raw counters.
    for (const file of tests) raw[path.resolve(file)] = coverage(file);
    fs.writeFileSync('.nyc_output/out.json', JSON.stringify({...baseline, ...raw}));
    execFileSync('node_modules/.bin/nyc', ['report'], {encoding: 'utf8'});
    const direct = JSON.parse(fs.readFileSync('coverage/js/coverage-summary.json'));
    assert.deepEqual(Object.keys(direct).sort(), [loaded, unvisited, 'total'].sort());
    assert.equal(direct.total.statements.pct, 50);
});

test('reporting still rejects application coverage outside the discovered scope', t => {
    fixture(t);
    const file = path.resolve('src/vendor/unexpected.js');
    fs.writeFileSync('.nyc_output/out.json', JSON.stringify({[file]: coverage(file)}));
    assert.throws(() => execFileSync(process.execPath, [`${projectRoot}/bin/report-browser.cjs`], {encoding: 'utf8', stdio: 'pipe'}),
        error => error.status !== 0 && error.stderr.toString().includes(`Browser coverage outside the discovered scope: ${file}`));
});

test('template scripts appear only in template coverage and unvisited JS files retain zeros', t => {
    const {base, write} = fixture(t);
    const file = `${base}/view/frontend/templates/example.phtml`;
    write(`src/${file}`, '<script>window.one = true;</script>\n<script>function unvisited() { window.two = true; }</script>');
    fs.writeFileSync('coverage.config.json', JSON.stringify({javascript: {libraries: [`${base}/view/frontend/web/js/loaded.js`]}}));
    prepare({themeRoots: []});
    const hits = {};
    const context = {window: {__mtcTemplateHit(id, statement) {const counters = hits[id] ||= {}; counters[statement] = (counters[statement] || 0) + 1;}}};
    for (const match of fs.readFileSync(`.runtime/${file}`, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(match[1], context);
    assert.equal(context.window.__coverage__, undefined);
    write('coverage/raw/templates/script.mtc', JSON.stringify({schemaVersion: 2, recordId: 'script', ids: [], hits}));
    execFileSync(process.execPath, [`${projectRoot}/bin/report-browser.cjs`], {encoding: 'utf8'});
    const summary = JSON.parse(fs.readFileSync('coverage/js/coverage-summary.json'));
    assert.ok(Object.keys(summary).every(key => key === 'total' || key.endsWith('.js')));
    const template = JSON.parse(fs.readFileSync('coverage/templates/coverage-summary.json')).templates.find(entry => entry.path === file);
    assert.equal(template.statementSummary.total, 2);
    assert.equal(template.statementSummary.covered, 1);
    assert.equal(template.functionSummary.total, 1);
    assert.equal(template.functionSummary.covered, 0);
    const report = JSON.parse(fs.readFileSync('coverage/javascript-summary.json'));
    assert.equal(report.groups.application.statements.total, 1);
    assert.equal(report.groups.libraries.statements.total, 1);
    assert.equal(report.groups.all.statements.covered, 0);
    assert.equal(report.inline, undefined);
});

test('required runtime assets must execute and stale counter maps are rejected', t => {
    const {base} = fixture(t);
    const file = `${base}/view/frontend/web/js/loaded.js`;
    fs.writeFileSync('coverage.config.json', JSON.stringify({javascript: {requiredExecuted: [file]}}));
    prepare({themeRoots: []});
    assert.throws(() => execFileSync(process.execPath, [`${projectRoot}/bin/report-browser.cjs`], {stdio: 'pipe'}), error => error.stderr.toString().includes('did not execute'));
    const raw = coverage(`src/${file}`);
    fs.mkdirSync('.nyc_output', {recursive: true});
    fs.writeFileSync('.nyc_output/out.json', JSON.stringify({[raw.path]: raw}));
    assert.throws(() => execFileSync(process.execPath, [`${projectRoot}/bin/report-browser.cjs`], {stdio: 'pipe'}), error => error.stderr.toString().includes('instrumentation is stale'));
});

test('rebuilding a Playwright report does not count its generated aggregate twice', t => {
    const {base} = fixture(t);
    const run = JSON.parse(fs.readFileSync('coverage/run.json'));
    run.runner = 'playwright';
    fs.writeFileSync('coverage/run.json', JSON.stringify(run));
    const context = {window: {}};
    vm.runInNewContext(fs.readFileSync(`.runtime/${base}/view/frontend/web/js/loaded.js`, 'utf8'), context);
    fs.writeFileSync('.nyc_output/playwright-example.json', JSON.stringify(context.window.__coverage__));
    const report = () => execFileSync(process.execPath, [`${projectRoot}/bin/report-browser.cjs`], {stdio: 'pipe'});
    report();
    const first = fs.readFileSync('coverage/js/coverage-final.json', 'utf8');
    report();
    assert.equal(fs.readFileSync('coverage/js/coverage-final.json', 'utf8'), first);
});
