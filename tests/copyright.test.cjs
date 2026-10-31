// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const script = path.resolve(__dirname, 'check-copyright.cjs');
const notice = 'SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko\n' +
    'SPDX-License-Identifier: Elastic-2.0\n' +
    'License: see LICENSE in the repository root.\n';
const slash = notice.trimEnd().split('\n').map(line => `// ${line}`).join('\n') + '\n';
const hash = notice.trimEnd().split('\n').map(line => `# ${line}`).join('\n') + '\n';
const markup = `<!--\n${notice}-->\n`;
const block = `/*\n${notice.trimEnd().split('\n').map(line => ` * ${line}`).join('\n')}\n */\n`;

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-copyright-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const git = (...args) => execFileSync('git', args, {cwd: root, stdio: 'pipe'});
    git('init', '--quiet');
    const write = (file, content, tracked = true) => {
        fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
        fs.writeFileSync(path.join(root, file), content);
        if (tracked) git('add', '--', file);
    };
    write('LICENSE', 'Elastic License 2.0\n');
    write('LICENSE.license', notice);
    const run = (directory = root) => spawnSync(process.execPath, [script], {cwd: directory, encoding: 'utf8'});
    return {root, write, git, run};
}

test('checks every tracked format while preserving language preambles and opaque files', t => {
    const {write, run, root} = fixture(t);
    const sources = {
        'bin/tool': `#!/usr/bin/env bash\n${hash}exit 0\n`,
        'script.cjs': `${slash}module.exports = 42;\n`,
        'template.phtml': `<?php\n${block}declare(strict_types=1); ?>Hello`,
        'module.xml': `<?xml version="1.0"?>\n${markup}<config/>\n`,
        'image.svg': `${markup}<svg/>\n`,
        'SKILL.md': `---\nname: fixture\n---\n${markup}# Fixture\n`,
        'styles.less': `${block}a { color: red; }\n`,
        '.github/workflows/ci.yml': `${hash}name: Checks\n`,
        '.gitignore': `${hash}generated/\n`,
        'settings.ini': notice.trimEnd().split('\n').map(line => `; ${line}\n`).join('') + 'enabled=1\n',
        'fix.patch': `${notice}\nSubject: Fixture\n`,
        'windows.js': `\uFEFF${slash}console.log(1);\n`.replace(/\n/g, '\r\n')
    };
    for (const [file, source] of Object.entries(sources)) write(file, source);
    for (const [file, source] of Object.entries({'package.json': '{}', 'composer.lock': '{}',
        'picture.png': Buffer.from([0x89, 0x50, 0, 0x01]), 'new-format.xyz': 'opaque payload'})) {
        write(file, source);
        write(`${file}.license`, notice);
    }
    write('generated/scratch.js', 'Untracked files are outside this check.', false);
    const result = run(path.join(root, '.github'));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /all 22 tracked files/);
    for (const [file, source] of Object.entries(sources)) {
        assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), source, 'The check is read-only');
    }
});

for (const [name, source] of [
    ['missing notice', 'module.exports = 1;\n'],
    ['copyright year', slash.replace('Private Entrepreneur', '2026 Private Entrepreneur')],
    ['wrong owner', slash.replace('Vitalii Boiko', 'Someone Else')],
    ['wrong license', slash.replace('Elastic-2.0', 'MIT')],
    ['missing license reference', slash.replace('// License: see LICENSE in the repository root.\n', '')],
    ['notice embedded in code', `const fixture = ${JSON.stringify(slash)};\n`],
    ['notice after executable code', `module.exports = 1;\n${slash}`]
]) {
    test(`rejects ${name}`, t => {
        const {write, run} = fixture(t);
        write('bad.js', source);
        const result = run();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /bad\.js.*Missing year-free copyright and license header/);
    });
}

test('reports new tracked files regardless of directory, extension or filename whitespace', t => {
    const {write, run} = fixture(t);
    for (const file of ['src/new.js', '.hidden/config.yml', 'future.format', 'space name.json', 'line\nbreak.png']) {
        write(file, 'missing');
    }
    const result = run();
    assert.equal(result.status, 1);
    for (const file of ['src/new.js', '.hidden/config.yml', 'future.format', 'space name.json', 'line\nbreak.png']) {
        assert.ok(result.stderr.includes(JSON.stringify(file)), result.stderr);
    }
});

test('sidecars must be tracked, valid and attached to a tracked file', t => {
    const {write, run, git} = fixture(t);
    write('data.json', '{}');
    write('data.json.license', notice, false);
    assert.match(run().stderr, /Missing tracked sidecar: data\.json\.license/);
    git('add', 'data.json.license');
    assert.equal(run().status, 0);
    write('data.json.license', notice.replace('Boiko', 'Other'));
    assert.match(run().stderr, /Expected the exact year-free copyright and license notice/);
    git('rm', '-f', 'data.json');
    assert.match(run().stderr, /License sidecar has no tracked target/);
});

test('a sidecar cannot replace a source header or be supplied by a symlink', t => {
    const {write, run, git, root} = fixture(t);
    write('source.js', 'module.exports = 1;');
    write('source.js.license', notice);
    assert.match(run().stderr, /source\.js.*Missing year-free copyright/);
    git('rm', '-f', 'source.js', 'source.js.license');
    write('asset.json', '{}');
    fs.symlinkSync('LICENSE.license', path.join(root, 'asset.json.license'));
    git('add', 'asset.json.license');
    assert.match(run().stderr, /License sidecar must be a regular file/);
});

test('symlinks need their own notices without reading their targets', t => {
    const {write, run, git, root} = fixture(t);
    fs.symlinkSync('missing-outside-checkout', path.join(root, 'link.js'));
    git('add', 'link.js');
    assert.match(run().stderr, /Missing tracked sidecar: link\.js\.license/);
    write('link.js.license', notice);
    assert.equal(run().status, 0);
});

test('vendored icons retain CC0 attribution and the referenced license', t => {
    const {write, run, git} = fixture(t);
    const upstream = 'SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko (MageLens packaging)\n' +
        'SPDX-FileCopyrightText: Simple Icons contributors\n' +
        'SPDX-License-Identifier: CC0-1.0\n' +
        'License: see assets/badge-icons/LICENSE.md in the repository root.\n';
    write('assets/badge-icons/LICENSE.md', '# CC0 1.0 Universal\n');
    write('assets/badge-icons/LICENSE.md.license', upstream);
    write('assets/badge-icons/php.svg', '<svg/>');
    write('assets/badge-icons/php.svg.license', upstream);
    assert.equal(run().status, 0);
    write('assets/badge-icons/php.svg.license', notice);
    assert.match(run().stderr, /php\.svg\.license.*Expected the exact year-free copyright/);
    git('rm', '-f', 'assets/badge-icons/LICENSE.md', 'assets/badge-icons/LICENSE.md.license');
    assert.match(run().stderr, /referenced CC0 license must be tracked/);
});

test('missing license text, unreadable tracked files and non-repositories fail', t => {
    const {run, git, root} = fixture(t);
    git('rm', '-f', 'LICENSE');
    fs.rmSync(path.join(root, 'LICENSE.license'));
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /LICENSE: the referenced license must be tracked/);
    assert.match(result.stderr, /ENOENT/);
    fs.rmSync(path.join(root, '.git'), {recursive: true});
    const outside = run();
    assert.notEqual(outside.status, 0);
    assert.match(outside.stderr, /Copyright check failed/);
});
