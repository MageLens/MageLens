// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {header, notice} = require('./check-copyright.cjs');
const script = path.join(__dirname, 'ci/static.cjs');

function fixture(t, files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-static-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    for (const [file, content] of Object.entries({LICENSE: 'Fixture license', 'LICENSE.license': notice('LICENSE'), ...files})) {
        fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
        fs.writeFileSync(path.join(root, file), content);
    }
    execFileSync('git', ['init', '--quiet', root]);
    execFileSync('git', ['add', '.'], {cwd: root});
    // Generated dependencies and runtime files must not expand the tracked lint scope.
    fs.writeFileSync(path.join(root, 'untracked.js'), 'this is not JavaScript');
    return spawnSync(process.execPath, [script], {cwd: root, encoding: 'utf8'});
}

test('static checks accept tracked Node, browser, Cypress and AMD sources with notices', t => {
    const sources = {
        'node.cjs': "const fs = require('node:fs'); module.exports = fs;",
        'branching/dashboard/app.js': "export const title = document.title;",
        'cypress/example.cy.js': "describe('page', () => it('opens', () => cy.visit('/')));",
        'src/view/frontend/web/js/component.js': "define([], () => window.location.href);"
    };
    const result = fixture(t, {
        ...Object.fromEntries(Object.entries(sources).map(([file, code]) => [file, header(file, 'slash') + code])),
        'valid.sh': header('valid.sh', 'hash') + 'exit 0',
        'valid.py': '#!/usr/bin/env python3\n' + header('valid.py', 'hash') + 'value = 1',
        'valid.php': '<?php\n' + header('valid.php', 'php') + 'return 1;'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ESLint checked 4 tracked JavaScript files/);
    assert.match(result.stdout, /Copyright and license notices verified/);
    assert.match(result.stdout, /Syntax checked 3 tracked/);
});

test('one static invocation rejects both JavaScript defects and missing copyright notices', t => {
    const result = fixture(t, {'bad.cjs': 'module.exports = missingVariable;'});
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /no-undef/);
    assert.match(result.stderr, /Missing year-free copyright and license header/);
});

test('static checks reject JavaScript parse errors and missing license sidecars', t => {
    const result = fixture(t, {'bad.cjs': header('bad.cjs', 'slash') + 'const =;', 'settings.json': '{}'});
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Parsing error/);
    assert.match(result.stderr, /Missing tracked sidecar: settings.json.license/);
});

test('static checks retain Bash, Python and PHP syntax validation', t => {
    const result = fixture(t, {
        'bad.sh': header('bad.sh', 'hash') + 'if then',
        'bad.py': '#!/usr/bin/env python3\n' + header('bad.py', 'hash') + 'def broken(',
        'bad.php': '<?php\n' + header('bad.php', 'php') + 'function {'
    });
    assert.equal(result.status, 1, result.stderr);
    for (const file of ['bad.sh', 'bad.py', 'bad.php']) assert.ok(result.stderr.includes(file), result.stderr);
    assert.match(result.stderr, /SyntaxError/);
    assert.match(result.stderr, /(?:PHP )?Parse error/);
    assert.match(result.stderr, /syntax error near unexpected token/);
    assert.match(result.stdout, /Syntax checked 0 tracked/);
});
