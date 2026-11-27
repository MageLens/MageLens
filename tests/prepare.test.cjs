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
const {Config, Parser} = require('html-validate');
const {prepare} = require(projectFile('bin/prepare.cjs'));
const {nginxConfig} = require(projectFile('bin/project.cjs'));
const projectRoot = projectFile();

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-prepare-'));
    const before = process.cwd();
    process.chdir(root);
    t.after(() => { process.chdir(before); fs.rmSync(root, {recursive: true, force: true}); });
    fs.copyFileSync(`${projectRoot}/package-lock.json`, 'package-lock.json');
    fs.writeFileSync('README.md', '<!-- coverage-badges:start -->\n<!-- coverage-badges:end -->');
    const write = (file, content) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content); };
    write('src/app/code/Acme/Blog/etc/module.xml', '<config><module name="Acme_Blog"/></config>');
    const base = 'app/code/Acme/Blog';
    write(`src/${base}/view/frontend/web/js/example.js`, 'window.answer = 42;');
    write(`src/${base}/view/frontend/web/template/example.html`, '<span data-bind="text: title"></span>');
    write(`src/${base}/Example.php`, '<?php echo 42;');
    return {root, base, write};
}
const read = file => JSON.parse(fs.readFileSync(file));

test('prepared Hyvä property bindings work before attaching the coverage observer', async t => {
    const {base, write} = fixture(t);
    const template = `${base}/view/frontend/templates/alpine.phtml`;
    const source = '<div id="panel" x-data="panel" @update-<?= $id ?>.window="update">\n<template id="loop" x-for="item in items"><span x-text="item"></span></template>\n</div>';
    write(`src/${template}`, source);
    prepare({runtimeOnly: true, themeRoots: []});
    const result = fs.readFileSync(`.runtime/${template}`, 'utf8');
    const entry = read('.runtime/template-manifest.json').templates.find(entry => entry.path === template);
    const eventSource = '@update-<?= $id ?>.window';
    assert.equal(result.split('\n').length, source.split('\n').length);
    assert.equal(fs.readFileSync(`src/${template}`, 'utf8'), source);
    assert.equal(entry.statements.find(({binding}) => binding === eventSource)?.start.line, 1);

    await t.test('rendered directives and markers identify the same bindings', t => {
        const php = spawnSync('php', ['-n'], {input: '<?php $id = 42; ?>' + result, encoding: 'utf8', timeout: 10000});
        if (php.error?.code === 'ENOENT') return t.skip('PHP CLI unavailable');
        assert.equal(php.status, 0, php.error?.message || php.stderr);
        const dom = new Parser(Config.empty().resolve()).parseHtml(php.stdout);
        const collector = read('package-lock.json').packages['node_modules/@magelens/magento-template-coverage'];
        const legacyMarkers = ['2.1.2', '2.1.3'].includes(collector.version);
        for (const [element, name, expression, originalName] of [
            [dom.querySelector('#panel'), 'x-data', 'panel', 'x-data'],
            [dom.querySelector('#panel'), '@update-42.window', 'update', eventSource],
            [dom.querySelector('#loop'), 'x-for', 'item in items', 'x-for']
        ]) {
            const {id} = entry.statements.find(({binding}) => binding === originalName);
            assert.equal(element.getAttributeValue(name), expression);
            assert.equal(element.getAttributeValue(`data-mtc-binding-${id}`), legacyMarkers ? '' : name);
        }
    });
});

test('repeated runs reuse browser files while resetting all execution artifacts', t => {
    const {base} = fixture(t);
    prepare({runtimeOnly: true, themeRoots: []});
    const script = `.runtime/${base}/view/frontend/web/js/example.js`;
    const template = `.runtime/${base}/view/frontend/web/template/example.html`;
    const mtimes = [script, template].map(file => fs.statSync(file, {bigint: true}).mtimeNs);
    prepare({themeRoots: []});
    const first = read('coverage/run.json');
    fs.writeFileSync('coverage/old-record.json', '{}');
    prepare({themeRoots: []});
    assert.notEqual(read('coverage/run.json').id, first.id);
    assert.equal(fs.existsSync('coverage/old-record.json'), false);
    assert.equal(fs.existsSync('coverage/.active-run'), false, 'Activation waits for collector preparation');
    assert.deepEqual([script, template].map(file => fs.statSync(file, {bigint: true}).mtimeNs), mtimes);
    const baseline = read('.runtime/js-baseline.json');
    assert.ok(Object.values(Object.values(baseline)[0].s).every(hit => hit === 0));
});

for (const readme of ['<!-- coverage-badges:start -->\nprevious results\n<!-- coverage-badges:end -->', '# Project without badge markers\r\n']) {
    test('default preparation preserves README bytes', t => {
        fixture(t);
        fs.writeFileSync('README.md', readme);
        prepare({themeRoots: []});
        assert.equal(fs.readFileSync('README.md', 'utf8'), readme);
    });
}

test('README updates require opt-in and full preparation', t => {
    fixture(t);
    const before = fs.readFileSync('README.md', 'utf8');
    prepare({runtimeOnly: true, updateReadme: true, themeRoots: []});
    assert.equal(fs.readFileSync('README.md', 'utf8'), before);
    fs.writeFileSync('themes.json', '[]');
    const result = spawnSync(process.execPath, [path.join(projectRoot, 'bin/prepare.cjs'),
        '--theme-roots', 'themes.json', '--update-readme'], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync('README.md', 'utf8'), /Coverage has not completed for the current run\./);
});

test('source edits update runtime files in place without rewriting unchanged browser instrumentation', t => {
    const {base, write} = fixture(t);
    prepare({runtimeOnly: true, themeRoots: []});
    const script = `.runtime/${base}/view/frontend/web/js/example.js`;
    const original = fs.statSync(script, {bigint: true}).mtimeNs;
    write(`src/${base}/Example.php`, '<?php echo 43;');
    prepare({themeRoots: []});
    assert.equal(fs.readFileSync(`.runtime/${base}/Example.php`, 'utf8'), '<?php echo 43;');
    assert.equal(fs.statSync(script, {bigint: true}).mtimeNs, original);
    write(`src/${base}/view/frontend/web/js/example.js`, 'window.answer = 43;');
    prepare({themeRoots: []});
    assert.match(fs.readFileSync(script, 'utf8'), /window.answer = 43/);
    fs.rmSync(`src/${base}/view/frontend/web/js/example.js`);
    prepare({themeRoots: []});
    assert.equal(fs.existsSync(script), false);
});

test('Test, Setup, and Cypress files remain plain while application instrumentation is reused', t => {
    const {base, write} = fixture(t);
    const sources = [
        `src/${base}/Test/Cypress/example.cy.js`,
        `src/${base}/Test/Cypress/support.js`,
        `src/${base}/Test/Cypress/helpers/navigation.js`,
        `src/${base}/Test/example.cy.js`,
        `src/${base}/cypress/support/commands.js`,
        `src/${base}/Test/Unit/example.js`,
        `src/${base}/Setup/Patch/example.js`
    ];
    for (const file of sources) write(file, 'window.testHelper = true;');
    const theme = 'app/design/adminhtml/Acme/admin';
    write(`src/${theme}/theme.xml`, '<theme/>');
    const templates = [
        `src/${base}/Test/fixtures/example.html`,
        `src/${base}/Setup/example.html`,
        `src/${theme}/Test/example.html`,
        `src/${theme}/Setup/example.html`
    ];
    for (const file of templates) write(file, '<span data-bind="text: fixture"></span>');
    sources.push(...templates);
    prepare({themeRoots: [theme]});
    const script = `.runtime/${base}/view/frontend/web/js/example.js`;
    const original = fs.statSync(script, {bigint: true}).mtimeNs;
    const baseline = read('.runtime/js-baseline.json');
    assert.deepEqual(Object.keys(baseline), [path.resolve(`src/${base}/view/frontend/web/js/example.js`)]);
    for (const manifest of ['.runtime/template-manifest.json', 'coverage/template-manifest.json']) {
        assert.deepEqual(read(manifest).templates.map(entry => entry.path), [`${base}/view/frontend/web/template/example.html`]);
    }
    for (const file of sources) {
        assert.equal(fs.readFileSync(path.join('.runtime', path.relative('src', file)), 'utf8'), fs.readFileSync(file, 'utf8'));
        assert.ok(file in read('coverage/run.json').sources, 'Excluded test code still participates in source integrity checks');
        assert.ok(!(file in read('.runtime/instrumentation.json').outputs));
    }
    write(sources[1], 'window.testHelper = false;');
    prepare({themeRoots: [theme]});
    assert.equal(fs.readFileSync(`.runtime/${base}/Test/Cypress/support.js`, 'utf8'), 'window.testHelper = false;');
    assert.equal(fs.statSync(script, {bigint: true}).mtimeNs, original);
});

test('preparing after an older release removes instrumented Setup copies and baseline entries', t => {
    const {base, write} = fixture(t);
    const source = `src/${base}/Setup/example.js`;
    const template = `src/${base}/Test/fixtures/example.html`;
    const original = 'window.testHelper = true;';
    write(source, original);
    write(template, '<span data-bind="text: fixture"></span>');
    prepare({runtimeOnly: true, themeRoots: []});
    const {createInstrumenter} = require('istanbul-lib-instrument');
    const instrumenter = createInstrumenter();
    fs.writeFileSync(`.runtime/${base}/Setup/example.js`, instrumenter.instrumentSync(original, path.resolve(source)));
    const {createManifest, instrument} = require('@magelens/magento-template-coverage');
    const oldManifest = createManifest({source: 'src', roots: ['app/code']});
    instrument({source: 'src', manifest: oldManifest, mappings: {'app/code': '.runtime/app/code'}});
    fs.writeFileSync('.runtime/template-manifest.json', JSON.stringify(oldManifest));
    const baseline = read('.runtime/js-baseline.json');
    baseline[path.resolve(source)] = instrumenter.lastFileCoverage();
    fs.writeFileSync('.runtime/js-baseline.json', JSON.stringify(baseline));
    const cache = read('.runtime/instrumentation.json');
    cache.signature = 'older-release';
    fs.writeFileSync('.runtime/instrumentation.json', JSON.stringify(cache));
    prepare({themeRoots: []});
    assert.equal(fs.readFileSync(`.runtime/${base}/Setup/example.js`, 'utf8'), original);
    assert.equal(fs.readFileSync(`.runtime/${base}/Test/fixtures/example.html`, 'utf8'), fs.readFileSync(template, 'utf8'));
    assert.ok(!read('.runtime/template-manifest.json').templates.some(entry => entry.path.includes('/Test/')));
    assert.equal(fs.readFileSync(source, 'utf8'), original);
    assert.ok(!(path.resolve(source) in read('.runtime/js-baseline.json')));
});

test('theme changes replace the report scope without changing PHP startup filters', t => {
    const {write} = fixture(t);
    const themes = ['app/design/frontend/Acme/one', 'app/design/frontend/Acme/two'];
    for (const theme of themes) {
        write(`src/${theme}/theme.xml`, '<theme/>');
        write(`src/${theme}/web/theme.js`, 'window.theme = true;');
    }
    prepare({runtimeOnly: true, themeRoots: [themes[0]]});
    const ini = fs.readFileSync('.runtime/coverage.ini', 'utf8');
    prepare({themeRoots: [themes[1]]});
    assert.equal(fs.readFileSync('.runtime/coverage.ini', 'utf8'), ini);
    assert.deepEqual(read('coverage/run.json').roots, ['app/code', themes[1]]);
    assert.equal(fs.readFileSync(`.runtime/${themes[0]}/web/theme.js`, 'utf8'), 'window.theme = true;');
    const baseline = read('.runtime/js-baseline.json');
    assert.ok(Object.keys(baseline).some(file => file.includes(themes[1])));
    assert.ok(!Object.keys(baseline).some(file => file.includes(themes[0])));
});

test('missing or damaged instrumented copies are rebuilt', t => {
    const {base} = fixture(t);
    prepare({runtimeOnly: true, themeRoots: []});
    const script = `.runtime/${base}/view/frontend/web/js/example.js`;
    const expected = fs.readFileSync(script, 'utf8');
    fs.writeFileSync(script, 'broken');
    prepare({themeRoots: []});
    assert.equal(fs.readFileSync(script, 'utf8'), expected);
});

test('template package owns PHTML bindings and scripts, while JS scope contains only JS files', t => {
    const {base, write} = fixture(t);
    const file = `${base}/view/frontend/templates/example.phtml`;
    const source = '<div x-data="{open: false}" x-show="open">Hello</div>\n<script>window.inline = 1;</script>\n<script>window.second = 2;</script>';
    write(`src/${file}`, source);
    prepare({themeRoots: []});
    const original = fs.readFileSync(`.runtime/${file}`, 'utf8');
    const baseline = read('.runtime/js-baseline.json');
    assert.ok(Object.keys(baseline).every(key => key.endsWith('.js')));
    assert.ok(read('coverage/template-manifest.json').templates.some(entry => entry.path === file));
    assert.equal(read('coverage/template-manifest.json').templates.find(entry => entry.path === file).scripts.length, 2);
    assert.equal(original.split('\n').length, source.split('\n').length);
    assert.equal(fs.readFileSync(`src/${file}`, 'utf8'), source);
    prepare({themeRoots: []});
    assert.equal(fs.readFileSync(`.runtime/${file}`, 'utf8'), original);
    assert.equal(read('coverage/template-manifest.json').templates.find(entry => entry.path === file).scripts.length, 2);
    assert.equal(read('coverage/template-manifest.json').templates.find(entry => entry.path === file).statements.length, 4);
    assert.doesNotMatch(fs.readFileSync(`.runtime/${file}`, 'utf8'), /cov_\w+/);
});

test('nginx uses the selected ports and rejects collisions and invalid ports', () => {
    const template = fs.readFileSync(`${projectRoot}/docker/nginx.conf`, 'utf8');
    const config = nginxConfig(template, {APPLICATION_PORT: '8088', APPLICATION_HTTPS_PORT: '8443', RUNNER_VIEW_PORT: '6090'});
    assert.match(config, /listen 8088;/);
    assert.match(config, /listen 8443 ssl;/);
    assert.match(config, /listen 6090 ssl;/);
    assert.throws(() => nginxConfig(template, {APPLICATION_PORT: '443'}), /different/);
    assert.throws(() => nginxConfig(template, {APPLICATION_PORT: '70000'}), /Invalid/);
});


test('both runners expose the same read-only viewer and accept the legacy port setting', () => {
    const template = fs.readFileSync(`${projectRoot}/docker/nginx.conf`, 'utf8');
    for (const runner of ['cypress', 'playwright']) {
        const config = nginxConfig(template, {MAGELENS_RUNNER: runner, CYPRESS_VIEW_PORT: '6090'});
        assert.match(config, /listen 6090 ssl/);
        assert.match(config, /http:\/\/runner:6080/);
        assert.match(config, /vnc.html\?autoconnect=1&resize=scale&view_only=1&reconnect=1/);
        const preferred = nginxConfig(template, {MAGELENS_RUNNER: runner, CYPRESS_VIEW_PORT: '6090', RUNNER_VIEW_PORT: '6091'});
        assert.match(preferred, /listen 6091 ssl/);
        assert.throws(() => nginxConfig(template, {MAGELENS_RUNNER: runner, RUNNER_VIEW_PORT: '443'}), /different/);
    }
});
