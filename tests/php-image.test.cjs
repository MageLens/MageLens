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
const packages = ['redis-6.3.0', 'ssh2-1.5.0', 'swoole-6.2.1', 'imagick-3.8.1'];

function workspace(t, buildExit = 0) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-php-image-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    for (const file of ['dependencies.yaml', 'bin/common', 'bin/dependencies', 'bin/build-php-image']) {
        fs.mkdirSync(path.dirname(path.join(directory, file)), {recursive: true});
        fs.copyFileSync(path.join(root, file), path.join(directory, file));
    }
    const pins = fs.readFileSync(path.join(directory, 'dependencies.yaml'), 'utf8');
    const series = pins.match(/^PHP_IMAGE: "php:(\d+\.\d+)\./m)[1];
    const recipe = path.join(directory, '.runtime/docker-magento/images/php', series, 'Dockerfile');
    fs.mkdirSync(path.dirname(recipe), {recursive: true});
    fs.writeFileSync(recipe, `FROM php:${series}-fpm-bookworm AS base\n\nRUN pecl channel-update pecl.php.net && pecl install \\\n${packages.map(name => `    ${name} \\`).join('\n')}\n  && pecl clear-cache\n\nFROM base AS xdebug\n`);
    const commands = path.join(directory, 'commands');
    fs.mkdirSync(commands);
    fs.mkdirSync(path.join(directory, 'extensions'));
    const mock = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify({command, args}) + '\\n');
if (command === 'docker') process.exit(${buildExit});
if (command === 'sleep') process.exit(1); // A build must never be retried.
if (command === 'php-config') console.log(process.env.MOCK_EXTENSIONS);
if (command === 'pecl' && args[0] === 'install') {
    for (const pin of args.slice(1)) {
        const name = pin.replace(/-[0-9].*$/, '');
        if (name === process.env.MOCK_FAIL_EXTENSION) process.exit(2);
        if (name !== process.env.MOCK_MISSING_EXTENSION) fs.writeFileSync(path.join(process.env.MOCK_EXTENSIONS, name + '.so'), 'extension');
    }
}
`;
    for (const name of ['docker', 'pecl', 'php-config', 'sleep']) fs.writeFileSync(path.join(commands, name), mock, {mode: 0o755});
    const env = {...process.env, PATH: `${commands}:${process.env.PATH}`, MOCK_LOG: path.join(directory, 'commands.jsonl'),
        MOCK_EXTENSIONS: path.join(directory, 'extensions')};
    const build = spawnSync('bash', ['bin/build-php-image'], {cwd: directory, env, encoding: 'utf8'});
    const calls = () => fs.readFileSync(env.MOCK_LOG, 'utf8').trim().split('\n').map(JSON.parse);
    const generated = fs.readFileSync(path.join(directory, '.runtime/php-base.Dockerfile'), 'utf8');
    const script = generated.split('\n\n').find(block => block.startsWith('RUN pecl ')).replace(/^RUN /, '');
    return {directory, env, build, calls, script};
}

test('PHP base installs every pinned extension before caching its layer', t => {
    const {directory, env, build, calls, script} = workspace(t);
    assert.equal(build.status, 0, build.stderr);
    const result = spawnSync('sh', ['-c', script], {cwd: directory, env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls().filter(call => call.command === 'pecl' && call.args[0] === 'install').map(call => call.args.slice(1)), packages.map(pin => [pin]));
    assert.equal(calls().at(-1).args[0], 'clear-cache');
});

for (const failure of ['missing', 'failed']) {
    test(`PHP base rejects a ${failure} Redis extension before installing later packages`, t => {
        const {directory, env, build, calls, script} = workspace(t);
        assert.equal(build.status, 0, build.stderr);
        env[failure === 'missing' ? 'MOCK_MISSING_EXTENSION' : 'MOCK_FAIL_EXTENSION'] = 'redis';
        const result = spawnSync('sh', ['-c', script], {cwd: directory, env, encoding: 'utf8'});
        assert.notEqual(result.status, 0, 'A partially installed extension layer must fail');
        assert.deepEqual(calls().filter(call => call.command === 'pecl').map(call => call.args), [
            ['channel-update', 'pecl.php.net'], ['install', packages[0]]
        ]);
    });
}

test('PHP image build failures are returned without rerunning the build', t => {
    const {build, calls} = workspace(t, 7);
    assert.equal(build.status, 7, build.stderr);
    assert.equal(calls().filter(call => call.command === 'docker').length, 1);
    assert.ok(calls().every(call => call.command !== 'sleep'));
});
