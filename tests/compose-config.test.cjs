// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const yaml = fs.readFileSync(path.join(root, 'dependencies.yaml'), 'utf8');
const configured = key => yaml.match(new RegExp(`^${key}: "([^"]+)"`, 'm'))[1];
const phpVersion = configured('PHP_IMAGE').match(/^php:([0-9]+\.[0-9]+\.[0-9]+)-/)[1];
const phpBase = () => `magelens-php-base:${phpVersion}-markshust${configured('MARKSHUST_DOCKER_MAGENTO_VERSION')}`;
function workspace(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-compose-config-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    return directory;
}

test('Compose inherits upstream services and uses the rebuilt PHP base with the selected patch', t => {
    if (spawnSync('docker', ['compose', 'version'], {stdio: 'ignore'}).status !== 0) return t.skip('Docker Compose CLI unavailable');
    const directory = workspace(t);
    for (const file of ['compose.yaml', 'dependencies.yaml', 'bin/common', 'bin/compose-project', 'bin/dependencies', 'bin/application-compose']) {
        fs.mkdirSync(path.dirname(path.join(directory, file)), {recursive: true});
        fs.copyFileSync(path.join(root, file), path.join(directory, file));
    }
    const upstream = path.join(directory, '.runtime/docker-magento/compose');
    fs.mkdirSync(upstream, {recursive: true});
    fs.writeFileSync(path.join(upstream, 'compose.yaml'), JSON.stringify({services: {
        app: {image: 'fixture/nginx:9.0'}, phpfpm: {image: 'fixture/php:8.5'},
        db: {image: 'fixture/db:12.0'}, redis: {image: 'fixture/cache:9.0'}, opensearch: {image: 'fixture/search:4.0'}
    }}));
    const config = JSON.parse(execFileSync('bash', ['bin/application-compose', 'config', '--format', 'json'], {cwd: directory, encoding: 'utf8'}));
    assert.equal(config.services.app.image, 'fixture/nginx:9.0');
    assert.equal(config.services.db.image, 'fixture/db:12.0');
    assert.equal(config.services.redis.image, 'fixture/cache:9.0');
    assert.equal(config.services.opensearch.image, 'fixture/search:4.0');
    assert.equal(config.services.phpfpm.build.args.PHP_IMAGE, phpBase());
    assert.equal(config.services.phpfpm.build.args.EXPECTED_PHP_VERSION, phpVersion);
    assert.equal(config.services.phpfpm.image, `magelens-php:${configured('MAGENTO_VERSION')}-php${phpVersion}-pcov${configured('PCOV_VERSION')}-markshust${configured('MARKSHUST_DOCKER_MAGENTO_VERSION')}`);
    assert.equal(config.services.phpfpm.environment.MAGENTO_VERSION, configured('MAGENTO_VERSION'));
    assert.equal(config.services.phpfpm.environment.MAGELENS_PLATFORM, 'magento');
    assert.equal(config.services.phpfpm.environment.MAGELENS_PLATFORM_VERSION, configured('MAGENTO_VERSION'));
    assert.equal(config.services.phpfpm.environment.APPLICATION_DOMAIN, 'magelens.test');
    assert.equal(config.services.phpfpm.environment.APPLICATION_HTTPS_PORT, '443');
    assert.equal(config.services.phpfpm.environment.RUNNER_VIEW_PORT, '6080');
    assert.deepEqual(config.services.app.ports.map(port => [port.host_ip, port.published, port.target]),
        [['127.0.0.1', '80', 80], ['127.0.0.1', '443', 443], ['127.0.0.1', '6080', 6080]]);
    assert.ok(config.services.app.networks.default.aliases.includes('magelens.test'));
    assert.equal(config.services.runner.environment.CYPRESS_BASE_URL, 'https://magelens.test:443');
    assert.equal(config.services.runner.build.args.RUNNER_IMAGE, configured('RUNNER_IMAGE'));
    for (const runner of ['cypress', 'playwright']) {
    for (const platform of ['magento', 'mageos']) {
        fs.writeFileSync(path.join(directory, '.runtime/install-profile'), `luma ${runner} ${platform}\n`);
        for (const [settings, port] of [
            [{}, '6080'],
            [{CYPRESS_VIEW_PORT: '6090'}, '6090'],
            [{CYPRESS_VIEW_PORT: '6090', RUNNER_VIEW_PORT: '6091'}, '6091']
        ]) {
            const selected = JSON.parse(execFileSync('bash', ['bin/application-compose', '--profile', 'tools', 'config', '--format', 'json'], {
                cwd: directory, encoding: 'utf8', env: {...process.env, CYPRESS_VIEW_PORT: '', RUNNER_VIEW_PORT: '', ...settings}
            }));
            assert.equal(selected.services.runner.build.target, runner);
            assert.equal(selected.services.phpfpm.environment.MAGELENS_PLATFORM, platform);
            assert.equal(selected.services.phpfpm.environment.MAGELENS_PLATFORM_VERSION, configured(platform === 'mageos' ? 'MAGEOS_VERSION' : 'MAGENTO_VERSION'));
            assert.equal(selected.services.workspace.environment.MAGELENS_PLATFORM, platform);
            assert.equal(selected.services.runner.environment.RUNNER_VIEW_PORT, port);
            assert.equal(selected.services.phpfpm.environment.RUNNER_VIEW_PORT, port);
            assert.ok(selected.services.app.ports.some(entry => entry.host_ip === '127.0.0.1' && entry.published === port && entry.target === Number(port)));
        }
    }
    }
});
