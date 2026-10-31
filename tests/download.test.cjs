// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

for (const platform of ['magento', 'mageos']) {
    for (const statuses of [[100, 100, 0], [2], [100, 100, 100]]) {
        test(`${platform} download handles Composer exit codes ${statuses.join(', ')}`, t => {
            if (spawnSync('php', ['--version'], {stdio: 'ignore'}).status !== 0) return t.skip('PHP CLI unavailable');
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-download-'));
            t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
            const vendor = platform === 'mageos' ? 'mage-os' : 'magento';
            const version = platform === 'mageos' ? '2.3.0' : '2.4.8-p5';
            const stage = path.join(directory, 'bootstrap', `${platform}-${version}`);
            const log = path.join(directory, 'calls.jsonl');
            fs.mkdirSync(path.join(directory, 'commands'));
            fs.mkdirSync(path.join(directory, 'bootstrap'));
            // Substitute only container mount locations; execute the real downloader,
            // development setup and source inventory code against a temporary tree.
            fs.writeFileSync(path.join(directory, 'download.sh'), fs.readFileSync(path.join(root, 'docker/php/download-magento.sh'), 'utf8')
                .replaceAll('/bootstrap/', `${directory}/bootstrap/`)
                .replaceAll('/application/docker/php/', `${root}/docker/php/`));
            fs.writeFileSync(path.join(directory, 'commands/composer'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'create-project') {
    const stage = args[3];
    fs.mkdirSync(path.join(stage, 'vendor/${vendor}/framework/Component'), {recursive: true});
    fs.writeFileSync(path.join(stage, 'composer.json'), JSON.stringify({require: {'${vendor}/product-community-edition': '${version}'}}));
    fs.writeFileSync(path.join(stage, 'vendor/${vendor}/framework/Component/ComponentRegistrar.php'), '<?php\\n');
} else if (args[0] === 'install') {
    const attempt = fs.existsSync('attempts') ? Number(fs.readFileSync('attempts')) : 0;
    fs.writeFileSync('attempts', String(attempt + 1));
    process.exit(${JSON.stringify(statuses)}[attempt] ?? 99);
}
`, {mode: 0o755});
            const run = () => spawnSync('bash', ['download.sh'], {cwd: directory, encoding: 'utf8', env: {
                ...process.env, PATH: `${directory}/commands:${process.env.PATH}`,
                MAGELENS_PLATFORM: platform, MAGELENS_PLATFORM_VERSION: version, MAGENTO_VERSION: '2.4.8-p5'
            }});
            const result = run();
            const success = statuses.at(-1) === 0;
            assert.equal(result.status, success ? 0 : statuses.at(-1), result.stderr);
            assert.equal(Number(fs.readFileSync(path.join(stage, 'attempts'))), statuses.length);
            assert.equal(fs.existsSync(path.join(stage, '.magelens-composer-ready')), success);
            assert.equal(fs.existsSync(path.join(stage, '.magelens-source.json')), success);
            const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
            const create = calls().find(args => args[0] === 'create-project');
            assert.ok(create.includes(`--repository=https://repo.${platform === 'mageos' ? 'mage-os.org' : 'magento.com'}/`));
            assert.ok(create.includes(`${vendor}/project-community-edition=${version}`));
            assert.equal(calls().filter(args => args[0] === 'create-project').length, 1);
            if (success) {
                assert.equal(JSON.parse(fs.readFileSync(path.join(stage, '.magelens-source.json'))).platform, platform);
                assert.equal(run().status, 0);
                assert.equal(calls().filter(args => args[0] === 'install').length, statuses.length, 'A ready download must be reused');
            }
        });
    }
}
