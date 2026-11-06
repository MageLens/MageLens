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
const bootstrap = path.join(root, 'bootstrap.sh');
const latestUrl = 'https://api.github.com/repos/MageLens/MageLens/releases/latest';
const archiveUrl = version => `https://github.com/MageLens/MageLens/archive/refs/tags/${version}.tar.gz`;

function workspace(t, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-bootstrap-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const destination = path.join(directory, 'project with spaces');
    const temporary = path.join(directory, 'temporary');
    const source = path.join(directory, 'release');
    const commands = path.join(directory, 'commands');
    const log = path.join(directory, 'downloads.jsonl');
    const archive = path.join(directory, 'release.tar.gz');
    for (const entry of [destination, temporary, source, commands]) fs.mkdirSync(entry);
    if (!options.missingInstaller) {
        fs.writeFileSync(path.join(source, 'install.sh'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > arguments
read -r answer
printf '%s\\n' "$answer" > answer
exit ${options.installStatus ?? 0}
`, {mode: 0o755});
    }
    fs.writeFileSync(path.join(source, '.hidden'), 'release contents\n');
    fs.symlinkSync('.hidden', path.join(source, 'linked'));
    execFileSync('tar', ['-czf', archive, '-C', directory, 'release']);
    if (options.corruptArchive) fs.truncateSync(archive, 20);
    // Only the network boundary is substituted; Bash, tar, file copying and the
    // installer handoff run normally in a disposable directory.
    fs.writeFileSync(path.join(commands, 'wget'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const url = args.at(-1);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(url) + '\\n');
if (url === ${JSON.stringify(latestUrl)}) {
    process.stdout.write(${JSON.stringify(options.metadata ?? '{\n  "tag_name": "v1.8.2",\n  "prerelease": false\n}\n')});
    process.exit(${options.lookupStatus ?? 0});
}
if (url !== ${JSON.stringify(archiveUrl(options.version || 'v1.8.2'))}) process.exit(99);
if (args[0] !== '-qO') process.exit(98);
fs.copyFileSync(${JSON.stringify(archive)}, args[1]);
process.exit(${options.downloadStatus ?? 0});
`, {mode: 0o755});
    return {
        destination,
        downloads: () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [],
        run(args = [], mode = 'file') {
            const invocation = mode === 'command'
                ? ['-c', fs.readFileSync(bootstrap, 'utf8'), '--', ...args]
                : [bootstrap, ...args];
            const result = spawnSync('bash', invocation, {
                cwd: destination, encoding: 'utf8', input: 'interactive answer\n', timeout: 10000,
                env: {...process.env, PATH: `${commands}:${process.env.PATH}`, TMPDIR: temporary,
                    MAGELENS_VERSION: options.version ?? ''}
            });
            assert.ifError(result.error);
            assert.equal(result.signal, null);
            assert.deepEqual(fs.readdirSync(temporary), [], 'Temporary downloads must be cleaned up');
            return result;
        }
    };
}

for (const mode of ['file', 'command']) {
    for (const version of ['', 'v1.8.1']) {
        test(`${mode} bootstrap installs ${version || 'latest'} and preserves arguments and stdin`, t => {
            const fixture = workspace(t, {version});
            const args = ['--mageos', '--hyva', '--playwright', '--container-only', '--project-name', 'client-shop', 'shop.test', 'one argument'];
            const result = fixture.run(args, mode);
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(fixture.downloads(), version ? [archiveUrl(version)] : [latestUrl, archiveUrl('v1.8.2')]);
            assert.equal(fs.readFileSync(path.join(fixture.destination, 'arguments'), 'utf8'), args.join('\n') + '\n');
            assert.equal(fs.readFileSync(path.join(fixture.destination, 'answer'), 'utf8'), 'interactive answer\n');
            assert.equal(fs.readFileSync(path.join(fixture.destination, '.hidden'), 'utf8'), 'release contents\n');
            assert.equal(fs.readlinkSync(path.join(fixture.destination, 'linked')), '.hidden');
            assert.ok(fs.statSync(path.join(fixture.destination, 'install.sh')).mode & 0o111);
        });
    }
}

for (const [name, options, message] of [
    ['failed lookup with partial output', {lookupStatus: 8}, /Could not look up/],
    ['empty response', {metadata: ''}, /valid release tag/],
    ['missing release tag', {metadata: '{"message":"API rate limit exceeded"}'}, /valid release tag/],
    ['invalid version override', {version: '../main'}, /valid release tag/],
    ['failed download with partial output', {downloadStatus: 4}, /Could not download/],
    ['corrupt archive', {corruptArchive: true}, /Could not extract/],
    ['missing installer', {missingInstaller: true}, /executable install.sh/]
]) {
    test(`bootstrap rejects ${name} without installing or leaving files`, t => {
        const fixture = workspace(t, options);
        const result = fixture.run();
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, message);
        assert.deepEqual(fs.readdirSync(fixture.destination), []);
        if (options.version) assert.deepEqual(fixture.downloads(), []);
        else if (options.lookupStatus || options.metadata !== undefined) assert.deepEqual(fixture.downloads(), [latestUrl]);
    });
}

for (const existing of ['user-file', '.env', 'dangling-link']) {
    test(`bootstrap refuses a directory containing ${existing} before any download`, t => {
        const fixture = workspace(t);
        const file = path.join(fixture.destination, existing);
        if (existing === 'dangling-link') fs.symlinkSync('missing', file);
        else fs.writeFileSync(file, 'preserve me\n');
        const result = fixture.run();
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /empty directory.*\.\/install\.sh/);
        assert.deepEqual(fixture.downloads(), []);
        assert.deepEqual(fs.readdirSync(fixture.destination), [existing]);
        if (existing === 'dangling-link') assert.equal(fs.readlinkSync(file), 'missing');
        else assert.equal(fs.readFileSync(file, 'utf8'), 'preserve me\n');
    });
}

test('bootstrap preserves the installer exit status and extracted files for recovery', t => {
    const fixture = workspace(t, {installStatus: 37});
    const result = fixture.run();
    assert.equal(result.status, 37, result.stderr);
    assert.ok(fs.existsSync(path.join(fixture.destination, 'install.sh')));
    assert.ok(fs.existsSync(path.join(fixture.destination, 'answer')));
});
