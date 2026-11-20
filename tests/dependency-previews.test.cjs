// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {configuration, verifyEvidence} = require('./ci/dependency-previews.cjs');
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
