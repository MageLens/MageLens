// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {configuration, verifyEvidence, pcovRecipe} = require('./ci/dependency-previews.cjs');
const source = {repository: 'MageLens/MagentoTemplateCoverage', pullRequest: 4, sha: 'a'.repeat(40), version: '1.5.5'};
test('preview configuration rejects floating refs, arbitrary repositories and untracked source PRs', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-preview-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.mkdirSync(path.join(root, '.github'));
    const write = value => fs.writeFileSync(path.join(root, '.github/dependency-previews.json'), JSON.stringify(value));
    assert.deepEqual(configuration(root), {});
    write({schema: 1, templateCoverage: source});
    assert.deepEqual(configuration(root), {templateCoverage: source});
    const pcov = {...source, repository: 'MageLens/PCOV'};
    for (const [templateRepo, pcovRepo] of [
        [source.repository, pcov.repository],
        ['MageLens/magento-template-coverage', 'MageLens/pcov'],
        ['VitaliyBoyko/magento-template-coverage', 'VitaliyBoyko/pcov']
    ]) {
        write({schema: 1, templateCoverage: {...source, repository: templateRepo}, pcov: {...pcov, repository: pcovRepo}});
        assert.deepEqual(configuration(root), {templateCoverage: source, pcov});
    }
    for (const patch of [{repository: pcov.repository}, {sha: 'main'}, {sha: 'a'.repeat(7)}, {repository: 'someone/another-package'}, {pullRequest: 0}, {version: 'latest'}]) {
        write({schema: 1, templateCoverage: {...source, ...patch}});
        assert.throws(() => configuration(root));
    }
    write({schema: 1, unexpectedLibrary: source});
    assert.throws(() => configuration(root));
    write({schema: 1});
    assert.throws(() => configuration(root));
});
test('the matrix rejects stale or missing dependency preview provenance', () => {
    const expected = {templateCoverage: source};
    const actual = {templateCoverage: {...source, tree: 'b'.repeat(40), archiveSha256: 'c'.repeat(64)}};
    assert.deepEqual(verifyEvidence(expected, actual), actual);
    assert.throws(() => verifyEvidence(expected, {}));
    assert.throws(() => verifyEvidence({}, actual));
    for (const patch of [{sha: 'd'.repeat(40)}, {version: '1.5.4'}, {archiveSha256: ''}, {tree: ''}]) {
        assert.throws(() => verifyEvidence(expected, {templateCoverage: {...actual.templateCoverage, ...patch}}));
    }
});

test('PCOV source previews preserve every unrelated PHP recipe installation', () => {
    // Preview preparation rewrites the worktree recipe before integration checks.
    const recipe = execFileSync('git', ['show', 'HEAD:compose/docker/php/Dockerfile'], {cwd: path.join(__dirname, '..'), encoding: 'utf8'});
    const preview = pcovRecipe(recipe);
    const blocks = [...recipe.matchAll(/^RUN [^\n]*(?:\n[ \t]+[^\n]*)*/gm)].map(match => match[0]);
    for (const block of blocks) {
        if (!block.includes('pie install "magelens/pcov:') && !block.startsWith('RUN mkdir /opt/pcov-tools')) {
            assert.ok(preview.includes(block), 'Unrelated PHP recipe blocks must be preserved');
        }
    }
    assert.ok(preview.includes('pecl install /tmp/opentelemetry.tgz'));
    assert.ok(preview.includes('COPY docker/php/dependency-preview-pcov /tmp/pcov-preview'));
    assert.ok(preview.includes('cp -a /tmp/pcov-preview/tools/. /opt/pcov-tools/'));
    assert.ok(!preview.includes('pie install "magelens/pcov:'));
    assert.ok(!preview.includes('refs/tags/v${PCOV_VERSION}'));
    assert.throws(() => pcovRecipe(recipe.replace('pie install "magelens/pcov:', 'pie install "other/pcov:')));
    assert.throws(() => pcovRecipe(recipe.replace('RUN mkdir /opt/pcov-tools', 'RUN mkdir /opt/other-tools')));
});
