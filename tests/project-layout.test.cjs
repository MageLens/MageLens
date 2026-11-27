// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {projectFile, projectRoot, repository} = require('./project-path.cjs');
const {inputs, kinds} = require(projectFile('bin/image-inputs.cjs'));

test('source archives install a standalone project without maintainer files', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-project-layout-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    // Exercise Git's real export-ignore behavior using the staged candidate tree.
    const tree = execFileSync('git', ['write-tree'], {cwd: repository, encoding: 'utf8'}).trim();
    const archive = path.join(directory, 'release.tar');
    execFileSync('git', ['archive', '--format=tar', '--prefix=MageLens/', `--output=${archive}`, tree], {cwd: repository});
    const entries = execFileSync('tar', ['-tf', archive], {encoding: 'utf8'}).trim().split('\n');
    assert.ok(entries.includes('MageLens/compose/AGENTS.md'));
    assert.ok(entries.every(file => file === 'MageLens/' || file.startsWith('MageLens/compose/')), entries.join('\n'));
    const trackedProjectFiles = execFileSync('git', ['ls-files', '-z', '--', 'compose/'], {cwd: repository, encoding: 'utf8'}).split('\0').filter(Boolean).map(file => 'MageLens/' + file).sort();
    assert.deepEqual(entries.filter(file => !file.endsWith('/')).sort(), trackedProjectFiles, 'The archive must contain every tracked project file');
    assert.ok(!entries.some(file => /(?:engineering-discipline|\/tests\/|\/\.github\/)/.test(file)));
    const installed = path.join(directory, 'project with spaces');
    fs.mkdirSync(installed);
    execFileSync('tar', ['-xf', archive, '--strip-components=2', '-C', installed]);
    for (const file of ['install.sh', 'bin/run-coverage']) {
        assert.ok(fs.statSync(path.join(installed, file)).mode & 0o111, `${file} must remain executable`);
        const output = execFileSync('bash', [file, '--help'], {cwd: installed, encoding: 'utf8'});
        assert.match(output, /Usage: \.\//);
    }
    for (const file of ['AGENTS.md', 'LICENSE', 'README.md', '.gitignore', 'dependencies.yaml', '.agents/skills/coverage-database/SKILL.md', 'bin/xml-report/layout/index.cjs', 'bin/share-report-render.cjs', 'bin/share-report-templates/header.html']) {
        assert.ok(fs.statSync(path.join(installed, file)).isFile(), `Missing project file: ${file}`);
    }
    const guide = fs.readFileSync(path.join(installed, 'AGENTS.md'), 'utf8');
    assert.match(guide, /failing|fails/);
    assert.match(guide, /this project.s own CI/);
    assert.doesNotMatch(guide, /engineering-discipline|Required CI gate|release qualification/);
    // The E2E harness moves this fixture into src/, so its imports must resolve
    // from the installed module rather than from the repository's tests directory.
    const fixtureSpec = path.join(installed, 'src/app/code/MageLens/Compatibility/Test/Cli/compatibility.test.cjs');
    fs.mkdirSync(path.dirname(fixtureSpec), {recursive: true});
    fs.copyFileSync(path.join(__dirname, 'fixtures/compatibility/module/Test/Cli/compatibility.test.cjs'), fixtureSpec);
    const fixtureRequire = createRequire(fixtureSpec);
    for (const match of fs.readFileSync(fixtureSpec, 'utf8').matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
        assert.doesNotThrow(() => fixtureRequire.resolve(match[1]), `Installed fixture import: ${match[1]}`);
    }
    const relocated = path.join(directory, 'relocated project');
    fs.cpSync(installed, relocated, {recursive: true});
    for (const kind of kinds) assert.equal(inputs(installed, kind), inputs(relocated, kind), `Portable image inputs: ${kind}`);
    assert.deepEqual(fs.readdirSync(installed).filter(file => ['tests', '.github', 'bootstrap.sh', 'compose'].includes(file)), []);
});

test('test helpers resolve both contributor and standalone installed project roots', t => {
    assert.equal(projectRoot(repository), projectFile());
    const standalone = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-installed-paths-')));
    t.after(() => fs.rmSync(standalone, {recursive: true, force: true}));
    fs.mkdirSync(path.join(standalone, 'tests'));
    fs.copyFileSync(path.join(__dirname, 'project-path.cjs'), path.join(standalone, 'tests/project-path.cjs'));
    const installed = require(path.join(standalone, 'tests/project-path.cjs'));
    assert.equal(installed.projectFile('bin/run-coverage'), path.join(standalone, 'bin/run-coverage'));
    assert.equal(installed.projectRoot(standalone), standalone);
});
