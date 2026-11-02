// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const assert = require('node:assert/strict');
const [theme, runner, platform] = process.argv.slice(2);
assert.ok(['luma', 'hyva'].includes(theme));
assert.ok(['cypress', 'playwright'].includes(runner));
assert.ok(['magento', 'mageos'].includes(platform));
const manifest = JSON.parse(fs.readFileSync('package.json'));
const lock = JSON.parse(fs.readFileSync('package-lock.json'));
const selected = runner === 'cypress' ? ['cypress', '@cypress/code-coverage'] : ['@playwright/test', 'playwright', 'playwright-core'];
const rejected = runner === 'cypress' ? ['@playwright/test', 'playwright', 'playwright-core'] : ['cypress', '@cypress/code-coverage'];
let runnerBuild;
if (runner === 'cypress') {
    runnerBuild = require('../docker/runner/cypress-source/provenance.cjs').verifyInstalled();
}
for (const name of selected) assert.ok(fs.existsSync(`node_modules/${name}/package.json`), `Missing selected runner package: ${name}`);
for (const name of rejected) {
    assert.equal(manifest.devDependencies[name], undefined, `Unselected dependency in manifest: ${name}`);
    assert.equal(lock.packages[`node_modules/${name}`], undefined, `Unselected dependency in lock: ${name}`);
    assert.equal(fs.existsSync(`node_modules/${name}`), false, `Unselected runner installed: ${name}`);
}
assert.equal(fs.existsSync('/opt/cypress'), runner === 'cypress', 'Cypress controller must exist only in Cypress installs');
assert.equal(fs.existsSync('/opt/playwright'), false, 'Both runners use Chrome without a bundled Playwright browser');
fs.accessSync('/opt/google/chrome/chrome', fs.constants.X_OK);
assert.ok(fs.existsSync('/usr/share/novnc'), 'Both runners need the desktop viewer');
assert.ok(process.env.DISPLAY, 'Both runners need a container display');
require('node:child_process').execFileSync('xdpyinfo', ['-display', process.env.DISPLAY]);
require('node:child_process').execFileSync(process.execPath, ['/opt/magelens/healthcheck.cjs']);
if (runner === 'playwright') {
    const config = require('../playwright.config.cjs');
    assert.equal(config.use.headless, false);
    assert.equal(config.use.channel, 'chrome');
}
assert.equal(fs.readFileSync('.runtime/install-profile', 'utf8').trim(), `${theme} ${runner} ${platform}`);
const composer = JSON.parse(fs.readFileSync('src/composer.lock'));
const vendor = platform === 'mageos' ? 'mage-os' : 'magento';
const otherVendor = platform === 'mageos' ? 'magento' : 'mage-os';
const versionKey = platform === 'mageos' ? 'MAGEOS_VERSION' : 'MAGENTO_VERSION';
const dependencies = fs.readFileSync('dependencies.yaml', 'utf8');
const chromeVersion = dependencies.match(/^CHROME_VERSION: "([^"]+)"/m)[1];
assert.equal(require('node:child_process').execFileSync('/opt/google/chrome/chrome', ['--version'], {encoding: 'utf8'}).trim(),
    `Google Chrome for Testing ${chromeVersion}`, 'Both runners must install the pinned Chrome build');
const version = dependencies.match(new RegExp(`^${versionKey}: "([^"]+)"`, 'm'))[1];
const phpVersion = dependencies.match(/^PHP_IMAGE: "php:([0-9]+\.[0-9]+\.[0-9]+)-fpm-bookworm(?:@sha256:[a-f0-9]{64})?"/m)[1];
const runnerImageKey = runner === 'cypress' ? 'RUNNER_IMAGE' : 'PLAYWRIGHT_RUNNER_IMAGE';
const runnerImage = dependencies.match(new RegExp(`^${runnerImageKey}: "([^"]+)"`, 'm'))[1];
const expectedNodeVersion = runnerImage.match(/:(\d+\.\d+\.\d+)(?:-|$)/)?.[1];
assert.ok(expectedNodeVersion, `Runner image must identify its Node.js version: ${runnerImage}`);
const nodeVersion = require('node:child_process').execFileSync('node', ['--version'], {encoding: 'utf8'}).trim();
assert.equal(nodeVersion, `v${expectedNodeVersion}`, `${runner} must use the configured Node.js runtime`);
assert.equal(composer.packages.find(pkg => pkg.name === `${vendor}/product-community-edition`)?.version, version);
assert.equal(composer.packages.some(pkg => pkg.name === `${otherVendor}/product-community-edition`), false);
assert.ok(fs.existsSync(`src/vendor/${vendor}/framework/Component/ComponentRegistrar.php`));
assert.equal(JSON.parse(fs.readFileSync('src/.magelens-source.json')).platform, platform);
assert.equal(composer.packages.some(pkg => pkg.name === 'hyva-themes/magento2-default-theme'), false);
assert.equal(composer.packages.some(pkg => pkg.name === 'hyva-themes/magento2-default-theme-csp'), theme === 'hyva');
fs.writeFileSync('.runtime/e2e-installation.json', JSON.stringify({platform, version, phpVersion, nodeVersion, theme, runner, runnerBuild}) + '\n');
console.log(`Verified isolated ${platform}/${theme}/${runner} installation, Node.js ${nodeVersion}, packages, browsers and persisted selection.`);
