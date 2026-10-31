// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Exercise the real instrumenters and report filters without Magento credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');

if (process.argv[2] === 'browser') {
    execFileSync('node', ['bin/prepare.cjs', '--theme-roots', 'themes.json'], {stdio: 'inherit'});
    const context = {window: {}};
    vm.runInNewContext(fs.readFileSync('.runtime/app/code/Magento/Local/view/frontend/requirejs-config.js', 'utf8'), context);
    fs.mkdirSync('.nyc_output', {recursive: true});
    fs.writeFileSync('.nyc_output/out.json', JSON.stringify(context.window.__coverage__));
    execFileSync('node', ['bin/report-browser.cjs'], {stdio: 'inherit'});
    const js = JSON.parse(fs.readFileSync('coverage/js/coverage-summary.json'));
    for (const file of ['app/code/root.js',
        'app/code/Magento/Local/view/frontend/requirejs-config.js', 'app/design/frontend/Magento/local/web/js/theme.js']) {
        const metric = js[`/workspace/src/${file}`];
        assert.ok(metric && metric.lines.total > 0, `Missing JavaScript: ${file}`);
        assert.equal(metric.lines.covered > 0, file.endsWith('requirejs-config.js'));
    }
    assert.ok(!Object.keys(js).some(file => file.includes('/vendor/')));
    assert.ok(!Object.keys(js).some(file => file.includes('/inactive/')));
    assert.ok(!Object.keys(js).some(file => file.endsWith('.cy.js') || /\/(Test|Setup)\//.test(file)));
    const templates = JSON.parse(fs.readFileSync('coverage/templates/coverage-summary.json')).templates;
    assert.ok(templates.some(file => file.path === 'app/code/Magento/Local/view/frontend/web/template/example.html'));
    assert.ok(templates.some(file => file.path === 'app/design/frontend/Magento/local/web/template/example.html'));
    assert.ok(!templates.some(file => file.path.includes('vendor/')));
    assert.ok(!templates.some(file => file.path.includes('/inactive/')));
    assert.ok(!templates.some(file => /\/(Test|Setup)\//.test(file.path)));
    console.log('PASS: application JavaScript and unvisited templates reach browser reports; Test, Setup, and Cypress code is excluded.');
    process.exit(0);
}

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-scope-'));
const put = (file, contents) => {
    fs.mkdirSync(path.dirname(`${scratch}/${file}`), {recursive: true});
    fs.writeFileSync(`${scratch}/${file}`, contents);
};
try {
    const config = JSON.parse(execFileSync('bash', ['bin/application-compose', 'config', '--format', 'json'], {cwd: root, encoding: 'utf8'}));
    for (const file of ['bin', 'package.json', 'package-lock.json', 'README.md']) fs.cpSync(`${root}/${file}`, `${scratch}/${file}`, {recursive: true});
    for (const file of ['app/code/root.php', 'app/code/Magento/Local/registration.php',
        'app/code/Magento/Local/Setup.php', 'app/code/Magento/Local/Test.php',
        'app/code/Magento/Local/Setup/Upgrade.php', 'app/code/Magento/Local/Test/Example.php',
        'app/code/Magento/Local/Test/fixtures/example.phtml',
        'app/design/frontend/Magento/local/Test/example.php', 'app/design/frontend/Magento/local/Setup/example.phtml',
        'app/design/frontend/Magento/local/templates/example.phtml', 'app/design/frontend/Magento/inactive/templates/example.phtml',
        'vendor/magento/example/vendor.php']) {
        put(`src/${file}`, '<?php $scopeExample = 42;\n');
    }
    for (const file of ['app/code/root.js', 'app/code/Magento/Local/Test/example.cy.js',
        'app/code/Magento/Local/Test/Cypress/support.js',
        'app/code/Magento/Local/Test/Unit/example.js', 'app/code/Magento/Local/Setup/example.js',
        'app/design/frontend/Magento/local/Test/example.js', 'app/design/frontend/Magento/local/Setup/example.js',
        'app/code/Magento/Local/view/frontend/requirejs-config.js', 'app/design/frontend/Magento/local/web/js/theme.js',
        'app/design/frontend/Magento/inactive/web/js/theme.js', 'vendor/magento/example/vendor.js']) put(`src/${file}`, 'var config = {example: true};\n');
    for (const file of ['app/code/Magento/Local/view/frontend/web/template/example.html',
        'app/code/Magento/Local/Test/fixtures/example.html', 'app/code/Magento/Local/Setup/example.html',
        'app/design/frontend/Magento/local/Test/example.html', 'app/design/frontend/Magento/local/Setup/example.html',
        'app/design/frontend/Magento/local/web/template/example.html', 'app/design/frontend/Magento/inactive/web/template/example.html',
        'vendor/magento/example/vendor.html']) {
        put(`src/${file}`, '<span data-bind="text: label">Example</span>\n');
    }
    for (const file of ['composer.json', 'composer.lock']) put(`src/${file}`, '{}');
    put('themes.json', JSON.stringify(['app/design/frontend/Magento/local']));
    for (const theme of ['local', 'inactive']) put(`src/app/design/frontend/Magento/${theme}/theme.xml`, '<theme/>');
    for (const file of ['app/etc/config.php', 'app/etc/env.php']) put(`src/${file}`, '<?php return [];');
    const run = args => execFileSync('docker', ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, ...args], {stdio: 'inherit'});
    const bind = (source, target) => ['--mount', `type=bind,source=${source},target=${target}`];
    const dependencies = config.services.runner.volumes.find(volume => volume.target === '/workspace/node_modules').source;
    run([
        ...bind(scratch, '/workspace'), ...bind(`${scratch}/src`, '/source'), ...bind(`${root}/tests`, '/tests'),
        '--mount', `type=volume,source=${config.volumes[dependencies].name},target=/workspace/node_modules,readonly`,
        '--workdir', '/workspace', '--entrypoint', 'node', config.services.runner.image || `${config.name}-runner`,
        '/tests/coverage-scope.cjs', 'browser'
    ]);
    run([
        ...bind(`${scratch}/src`, '/var/www/html'), ...bind(`${root}/docker`, '/application/docker'),
        ...bind(`${scratch}/.runtime/project.json`, '/application/project.json'),
        ...bind(`${scratch}/.runtime/coverage.ini`, '/usr/local/etc/php/conf.d/zzz-magelens-scope.ini'),
        ...bind(`${root}/tests`, '/tests'), '--entrypoint', 'php', config.services.phpfpm.image, '/tests/coverage-scope.php'
    ]);
} finally {
    fs.rmSync(scratch, {recursive: true, force: true});
}
