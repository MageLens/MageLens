// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {createManifest, merge} = require('@vitaliiboiko/magento-template-coverage');

const cli = path.resolve(__dirname, '../bin/export-coverage.cjs');
const moduleRoot = 'app/code/Example/Checkout';
const php = moduleRoot + '/Model/Shipping.php';
const js = moduleRoot + '/view/frontend/web/js/shipping.js';
const template = moduleRoot + '/view/frontend/web/template/shipping.html';
const xml = moduleRoot + '/etc/config.xml';
const runId = '1234567890abcdef1234567890abcdef';
const sourceText = '<div>ORIGINAL_SOURCE_ONLY</div>';
const privateMarker = 'PRIVATE_RUNTIME_VALUE';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-share-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const write = (file, contents) => {
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, contents);
    };
    const artifact = (file, value) => write('coverage/' + file, JSON.stringify(value));
    const read = file => fs.readFileSync(path.join(root, 'coverage', file), 'utf8');
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], {cwd: root, encoding: 'utf8'});
    const sources = {};
    for (const [file, contents] of Object.entries({
        [php]: "<?php\nreturn 'shipping';\n",
        [js]: 'define(function () { return true; });',
        [template]: sourceText,
        [xml]: '<config><default><shipping/></default></config>',
        [moduleRoot + '/Test/MageLens/hooks.php']: "<?php\nreturn '" + privateMarker + "';\n"
    })) {
        write('src/' + file, contents);
        sources['src/' + file] = createHash('sha256').update(contents).digest('hex');
    }
    const roots = ['app/code'];
    fs.mkdirSync(path.join(root, '.runtime'));
    artifact('run.json', {id: runId, runner: 'cypress', roots, sources});
    const metrics = {php: {percent: 50}, js: {percent: 100}, templates: {percent: null}, xml: {percent: 100}};
    artifact('summary.json', {run: runId, generatedAt: '2026-11-17T12:00:00.000Z', metrics,
        templateLimitations: {directives: [{reason: privateMarker}]}});
    write('coverage/index.html', '<html>' + privateMarker + '</html>');
    artifact('project-fixtures.json', {customer: {password: privateMarker}});
    artifact('raw/php/' + runId + '/request.json', {uri: '/checkout/?token=' + privateMarker});
    artifact('cypress-results.json', {run: runId, totalTests: 1, totalPassed: 1, totalFailed: 0,
        totalSkipped: 0, totalPending: 0, tests: [{title: privateMarker, status: 'passed'}]});
    artifact('php/coverage-summary.json', {run: runId, covered: 1, total: 2, percent: 50,
        requests: [{uri: '/checkout/?token=' + privateMarker}]});
    artifact('php/line-coverage.json', {[php]: {1: 0, 2: 1}});
    const statements = {covered: 1, total: 1, pct: 100, skipped: 0};
    const coveragePath = '/workspace/src/' + js;
    artifact('js/coverage-summary.json', {total: {statements}, [coveragePath]: {statements}});
    artifact('javascript-scope.json', {run: runId, included: [{path: js, coveragePath, group: 'application'}]});
    const templates = merge(createManifest({source: path.join(root, 'src'), roots}), []);
    artifact('templates/coverage-summary.json', templates);
    artifact('xml/coverage.json', {run: runId, complete: true, sourcesUnchanged: true, collectorErrors: [],
        covered: 1, total: 1, percent: 100, warnings: [{reason: privateMarker}],
        files: [{path: xml, covered: 1, total: 1, lines: {1: {state: 'covered', hits: 1}},
            declarations: [], sourceHash: sources['src/' + xml]}]});
    return {root, write, artifact, read, run};
}

test('the default export contains only file paths and projected results, including an empty metric', t => {
    const report = fixture(t);
    const result = report.run();
    assert.equal(result.status, 0, result.stderr);
    const html = report.read('share.html');
    for (const file of [php, js, template, xml]) assert.ok(html.includes(file), file);
    assert.match(html, /Template executable lines<\/th><td>0<\/td><td>0<\/td><td>N\/A<\/td>/);
    assert.doesNotMatch(html, /NaN|PRIVATE_RUNTIME_VALUE|ORIGINAL_SOURCE_ONLY|\/workspace\/src\/|project-fixtures\.json/);
    for (const [, href] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
        assert.ok(href.startsWith('#'), 'Export should open offline using only the shared file');
    }
    assert.equal(fs.existsSync(path.join(report.root, 'coverage/share-with-source.html')), false);
});

test('opting into source escapes the original and keeps runtime data out of both exports', t => {
    const report = fixture(t);
    const clean = report.run();
    assert.equal(clean.status, 0, clean.stderr);
    const original = report.read('share.html');
    const result = report.run('--include-source');
    assert.equal(result.status, 0, result.stderr);
    const html = report.read('share-with-source.html');
    assert.ok(html.includes('&lt;div&gt;ORIGINAL_SOURCE_ONLY&lt;/div&gt;'));
    assert.ok(!html.includes(sourceText));
    assert.ok(!html.includes(privateMarker));
    assert.equal(report.read('share.html'), original);
});

test('a completed three-report run from v1.9.4 exports without XML or a source checkout', t => {
    const report = fixture(t);
    const summary = JSON.parse(report.read('summary.json'));
    delete summary.metrics.xml;
    report.artifact('summary.json', summary);
    fs.rmSync(path.join(report.root, 'coverage/xml'), {recursive: true});
    fs.rmSync(path.join(report.root, 'src'), {recursive: true});
    const result = report.run();
    assert.equal(result.status, 0, result.stderr);
    const html = report.read('share.html');
    for (const file of [php, js, template]) assert.ok(html.includes(file), file);
    assert.ok(!html.includes(xml));
});

test('the documented shell command runs both export modes through the selected runner', t => {
    const report = fixture(t);
    report.write('bin/application-compose', `#!/usr/bin/env bash
[[ "$1" == exec && "$2" == -T && "$3" == runner && "$4" == node && "$5" == bin/export-coverage.cjs ]] || exit 2
shift 3
exec "$@"
`);
    fs.chmodSync(path.join(report.root, 'bin/application-compose'), 0o755);
    const launcher = path.join(report.root, 'bin/export-coverage');
    fs.copyFileSync(path.join(__dirname, '../bin/export-coverage'), launcher);
    fs.symlinkSync(cli, path.join(report.root, 'bin/export-coverage.cjs'));
    for (const [args, file] of [[[], 'share.html'], [['--include-source'], 'share-with-source.html']]) {
        const result = spawnSync('bash', [launcher, ...args], {cwd: os.tmpdir(), encoding: 'utf8'});
        assert.equal(result.status, 0, result.stderr);
        assert.ok(report.read(file).includes(js));
    }
    const invalid = spawnSync('bash', [launcher, '--unknown'], {encoding: 'utf8'});
    assert.notEqual(invalid.status, 0);
});

test('an export respects another running workflow and releases its own lock after success', t => {
    const report = fixture(t);
    report.write('.runtime/workflow.lock/active-workflow', 'existing owner');
    assert.notEqual(report.run().status, 0);
    const lock = path.join(report.root, '.runtime/workflow.lock');
    assert.equal(fs.readFileSync(path.join(lock, 'active-workflow'), 'utf8'), 'existing owner');
    assert.equal(fs.existsSync(path.join(report.root, 'coverage/share.html')), false);
    fs.rmSync(lock, {recursive: true});
    const result = report.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(lock), false);
});

test('an incomplete, active, or stale run cannot produce an export', t => {
    const report = fixture(t);
    const index = 'coverage/index.html';
    fs.unlinkSync(path.join(report.root, index));
    assert.notEqual(report.run().status, 0);
    report.write(index, '<html></html>');
    report.write('coverage/.active-run', runId);
    assert.notEqual(report.run().status, 0);
    fs.unlinkSync(path.join(report.root, 'coverage/.active-run'));
    report.artifact('summary.json', {...JSON.parse(report.read('summary.json')), run: 'other-run'});
    assert.notEqual(report.run().status, 0);
    assert.equal(fs.existsSync(path.join(report.root, 'coverage/share.html')), false);
});

test('a fixture hook cannot be exported as a measured PHP file even when it is in the source inventory', t => {
    const report = fixture(t);
    report.artifact('php/line-coverage.json', {[moduleRoot + '/Test/MageLens/hooks.php']: {1: 0, 2: 1}});
    assert.notEqual(report.run().status, 0);
    assert.notEqual(report.run('--include-source').status, 0);
    for (const name of ['share.html', 'share-with-source.html']) {
        assert.equal(fs.existsSync(path.join(report.root, 'coverage', name)), false);
    }
});

test('opt-in declines modified and symlinked originals, even if the symlink target matches the recorded hash', t => {
    const report = fixture(t);
    report.write('src/' + template, 'changed');
    assert.notEqual(report.run('--include-source').status, 0);
    const original = path.join(report.root, 'src', template);
    const outside = path.join(report.root, 'outside.html');
    report.write('outside.html', sourceText);
    fs.unlinkSync(original);
    fs.symlinkSync(outside, original);
    assert.notEqual(report.run('--include-source').status, 0);
    assert.equal(fs.existsSync(path.join(report.root, 'coverage/share-with-source.html')), false);
});
