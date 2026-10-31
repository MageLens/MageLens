// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {prepare} = require('../bin/prepare.cjs');
const {nginxConfig} = require('../bin/project.cjs');
const projectRoot = path.resolve(__dirname, '..');

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
    const {createManifest, instrument} = require('@vitaliiboiko/magento-template-coverage');
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
