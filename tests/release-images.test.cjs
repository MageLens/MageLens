// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {kinds, inputs, platforms} = require('../bin/image-inputs.cjs');
const {manifest} = require('./release/images.cjs');
const {obsoleteVersions, prune} = require('./release/prune-images.cjs');
const digest = letter => 'sha256:' + letter.repeat(64);
const root = path.join(__dirname, '..');
const published = {schema: 1, platform: 'linux/amd64', version: require('../package.json').version,
    images: Object.fromEntries(kinds.map(kind => [kind, {inputs: inputs(root, kind), digest: digest('a')}]))};

test('retention keeps the published digest even when a newer failed candidate exists', () => {
    assert.deepEqual(obsoleteVersions([{id: 1, name: digest('0')}, {id: 2, name: digest('a')}, {id: 3, name: digest('b')}], digest('a')), [1, 3]);
    assert.throws(() => obsoleteVersions([{id: 1, name: digest('b')}], digest('a')), /Published image missing/);
    assert.throws(() => obsoleteVersions([{id: '../wrong', name: digest('a')}], digest('a')), /Invalid/);
});
function mockApi(overrides = {}) {
    const calls = [];
    const execute = args => {
        calls.push(args);
        if (args.includes('DELETE')) return '';
        const endpoint = args.at(-1);
        if (endpoint.endsWith('/releases/latest') || endpoint.includes('/releases?') || endpoint.endsWith('/releases')) {
            if (overrides.networkFailure) throw new Error('Network unavailable');
            const release = {tag_name: `v${published.version}`, assets: overrides.noManifest ? [] : [{id: 123, name: 'images.json'}]};
            const releases = overrides.noManifest ? [] : [release, ...(overrides.historicalReleases || [])];
            return JSON.stringify([releases]);
        }
        if (endpoint.includes('/releases/assets/')) {
            const assetId = Number(endpoint.split('/').at(-1));
            return JSON.stringify(overrides.assets?.[assetId] || published);
        }
        if (endpoint.includes('/versions?')) return JSON.stringify([[{id: 1, name: overrides.missingLatest ? digest('c') : digest('a')}], [{id: 2, name: digest('b')}, {id: 3, name: digest('0')}]]);
        return JSON.stringify({repository: {full_name: overrides.otherRepository ? 'Other/Project' : 'MageLens/MageLens'}});
    };
    return {calls, execute};
}
test('cleanup paginates all three allowlisted packages and deletes only obsolete versions', () => {
    const {calls, execute} = mockApi();
    prune(execute);
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 6);
    for (const args of deletions) assert.match(args.at(-1), /^orgs\/MageLens\/packages\/container\/(php|runner-cypress|runner-playwright)\/versions\/[23]$/);
    assert.equal(calls.filter(args => args.includes('--paginate')).length, 4);
});
for (const failure of ['networkFailure', 'otherRepository', 'missingLatest']) {
    test(`cleanup refuses all deletion after ${failure}`, () => {
        const {calls, execute} = mockApi({[failure]: true});
        assert.throws(() => prune(execute));
        assert.equal(calls.filter(args => args.includes('DELETE')).length, 0);
    });
}
test('first image publication retains only one candidate per package for public visibility setup', () => {
    const {calls, execute} = mockApi({noManifest: true});
    prune(execute);
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 6);
    for (const args of deletions) assert.match(args.at(-1), /\/versions\/[12]$/);
});
test('cleanup retains historical release images across versions while deleting failed candidates', () => {
    const historicalReleases = [{tag_name: 'v1.9.2', assets: [{id: 124, name: 'images.json'}]}];
    const historicalManifest = {schema: 1, platform: 'linux/amd64', version: '1.9.2',
        images: Object.fromEntries(kinds.map(kind => [kind, {inputs: inputs(root, kind), digest: digest('b')}]))};
    const {calls, execute} = mockApi({historicalReleases, assets: {124: historicalManifest}});
    prune(execute);
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 3);
    for (const args of deletions) assert.match(args.at(-1), /^orgs\/MageLens\/packages\/container\/(php|runner-cypress|runner-playwright)\/versions\/3$/);
});
test('cleanup succeeds and retains available images even if older historical release images were previously purged', () => {
    const historicalReleases = [{tag_name: 'v1.9.2', assets: [{id: 124, name: 'images.json'}]}];
    const historicalManifest = {schema: 1, platform: 'linux/amd64', version: '1.9.2',
        images: Object.fromEntries(kinds.map(kind => [kind, {inputs: inputs(root, kind), digest: digest('9')}]))};
    const {calls, execute} = mockApi({historicalReleases, assets: {124: historicalManifest}});
    prune(execute);
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 6);
    for (const args of deletions) assert.match(args.at(-1), /\/versions\/[23]$/);
});
test('release manifest accepts only all six native images from the current commit, run and attempt', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-release-manifest-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const env = {RELEASE_SHA: 'candidate', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2'};
    for (const platform of platforms) {
        fs.mkdirSync(path.join(directory, platform.split('/')[1]));
        for (const kind of kinds) fs.writeFileSync(path.join(directory, platform.split('/')[1], `${kind}.json`), JSON.stringify({kind, platform, ...published.images[kind], sha: 'candidate', run: '123', attempt: '2'}));
    }
    assert.deepEqual(manifest(directory, root, env), {schema: 1, platform: 'linux/amd64', images: published.images, version: published.version,
        platforms: Object.fromEntries(platforms.map(platform => [platform, published.images]))});
    const arm = path.join(directory, 'arm64/php.json');
    const original = fs.readFileSync(arm);
    for (const [key, value] of Object.entries({platform: 'linux/amd64', inputs: '0'.repeat(64), digest: 'latest', run: 'old', attempt: 'old', sha: 'old'})) {
        fs.writeFileSync(arm, JSON.stringify({...JSON.parse(original), [key]: value}));
        assert.throws(() => manifest(directory, root, env));
    }
    fs.writeFileSync(arm, original);
    for (const key of Object.keys(env)) assert.throws(() => manifest(directory, root, {...env, [key]: 'stale'}), /Wrong release/);
    fs.rmSync(path.join(directory, 'arm64/php.json'));
    assert.throws(() => manifest(directory, root, env), /ENOENT/);
});

test('retention preserves both native architectures and refuses a partially missing release', () => {
    const versions = ['a', 'b', 'c'].map((letter, index) => ({id: index + 1, name: digest(letter)}));
    assert.deepEqual(obsoleteVersions(versions, [digest('a'), digest('b')]), [3]);
    assert.throws(() => obsoleteVersions(versions, [digest('a'), digest('d')]), /Published image missing/);
});
test('cleanup retains both native digests from the extended manifest', () => {
    const legacy = mockApi();
    prune(args => {
        if (args.at(-1).includes('/releases/assets/')) return JSON.stringify({schema: 1, platform: 'linux/amd64', images: published.images, version: published.version,
            platforms: {'linux/amd64': published.images, 'linux/arm64': Object.fromEntries(kinds.map(kind => [kind, {...published.images[kind], digest: digest('b')}]))}});
        return legacy.execute(args);
    });
    const deletions = legacy.calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 3);
    for (const args of deletions) assert.match(args.at(-1), /versions\/3$/);
});
