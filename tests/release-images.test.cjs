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
            if (overrides.releases) return JSON.stringify([overrides.releases]);
            const release = {tag_name: `v${published.version}`, published_at: overrides.published_at || '2026-06-01T00:00:00Z', assets: overrides.noManifest ? [] : [{id: 123, name: 'images.json'}]};
            const releases = overrides.noManifest ? [] : [release, ...(overrides.historicalReleases || [])];
            return JSON.stringify([releases]);
        }
        if (endpoint.includes('/releases/assets/')) {
            if (overrides.assetFailure) throw new Error('Asset download failed');
            const assetId = Number(endpoint.split('/').at(-1));
            return JSON.stringify(overrides.assets?.[assetId] || published);
        }
        if (endpoint.includes('/versions?')) {
            if (overrides.packageVersions) return JSON.stringify(overrides.packageVersions(endpoint));
            return JSON.stringify([[{id: 1, name: overrides.missingLatest ? digest('c') : digest('a')}], [{id: 2, name: digest('b')}, {id: 3, name: digest('0')}]]);
        }
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

test('reproduction: protected release without manifest aborts cleanup before any DELETE request', () => {
    // Reproduction:
    // - v1.9.4 has no manifest, but its six images exist.
    // - v1.9.3 has a valid manifest and six images.
    // Cleanup must throw and make zero DELETE requests.
    const releases = [
        {tag_name: 'v1.9.4', published_at: '2026-06-01T00:00:00Z', assets: []},
        {tag_name: 'v1.9.3', published_at: '2026-05-01T00:00:00Z', assets: [{id: 193, name: 'images.json'}]}
    ];
    const manifest193 = {schema: 1, platform: 'linux/amd64', version: '1.9.3',
        images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: digest('3')}]))};
    const {calls, execute} = mockApi({releases, assets: {193: manifest193}});
    assert.throws(() => prune(execute), /Protected release v1.9.4 is missing images.json manifest; refusing cleanup/);
    assert.equal(calls.filter(args => args.includes('DELETE')).length, 0);
});

test('cleanup aborts with zero DELETE requests when a protected release manifest is invalid', () => {
    const releases = [{tag_name: 'v1.9.4', published_at: '2026-06-01T00:00:00Z', assets: [{id: 194, name: 'images.json'}]}];
    const invalidManifest = {schema: 1, platform: 'linux/amd64', version: '1.9.4', images: {php: {inputs: 'invalid', digest: 'invalid'}}};
    const {calls, execute} = mockApi({releases, assets: {194: invalidManifest}});
    assert.throws(() => prune(execute), /provenance/);
    assert.equal(calls.filter(args => args.includes('DELETE')).length, 0);
});

test('cleanup aborts with zero DELETE requests when protected release asset API fails', () => {
    const releases = [{tag_name: 'v1.9.4', published_at: '2026-06-01T00:00:00Z', assets: [{id: 194, name: 'images.json'}]}];
    const {calls, execute} = mockApi({releases, assetFailure: true});
    assert.throws(() => prune(execute), /Asset download failed/);
    assert.equal(calls.filter(args => args.includes('DELETE')).length, 0);
});

test('cleanup does not require manifests for releases that predate prebuilt-image support (< 1.9.0)', () => {
    const releases = [
        {tag_name: `v${published.version}`, published_at: '2026-06-01T00:00:00Z', assets: [{id: 123, name: 'images.json'}]},
        {tag_name: 'v1.8.9', published_at: '2025-01-01T00:00:00Z', assets: []}
    ];
    const {calls, execute} = mockApi({releases});
    prune(execute);
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 6);
});

test('release workflow pins cleanup to trusted github.sha in .cleanup-tools separately from release checkout', () => {
    const workflowPath = path.join(root, '.github/workflows/release.yml');
    const workflowContent = fs.readFileSync(workflowPath, 'utf8');

    const checkoutMatches = [...workflowContent.matchAll(/uses:\s*actions\/checkout@[^\n]+\n\s+with:\n\s+persist-credentials:\s*false\n\s+ref:\s*\$\{\{\s*github\.sha\s*\}\}\n\s+path:\s*\.cleanup-tools/g)];
    assert.equal(checkoutMatches.length, 2, 'Both pre- and post-publication cleanups must checkout github.sha to .cleanup-tools');

    const runMatches = [...workflowContent.matchAll(/node\s+\.cleanup-tools\/tests\/release\/prune-images\.cjs\s+&&\s+rm\s+-rf\s+\.cleanup-tools/g)];
    assert.equal(runMatches.length, 2, 'All cleanup invocations must execute from .cleanup-tools and remove it');

    assert.doesNotMatch(workflowContent, /run:\s*node\s+tests\/release\/prune-images\.cjs/);
});

test('retrying an older release cannot invoke historical cleanup in workspace', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-cleanup-pin-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));

    fs.mkdirSync(path.join(directory, 'tests/release'), {recursive: true});
    fs.writeFileSync(path.join(directory, 'tests/release/prune-images.cjs'), 'throw new Error("Outdated historical cleanup invoked!");');

    fs.mkdirSync(path.join(directory, '.cleanup-tools/tests/release'), {recursive: true});
    fs.mkdirSync(path.join(directory, '.cleanup-tools/bin'), {recursive: true});
    fs.copyFileSync(path.join(root, 'tests/release/prune-images.cjs'), path.join(directory, '.cleanup-tools/tests/release/prune-images.cjs'));
    fs.copyFileSync(path.join(root, 'bin/image-inputs.cjs'), path.join(directory, '.cleanup-tools/bin/image-inputs.cjs'));

    const {execFileSync} = require('node:child_process');
    const result = execFileSync('node', ['-e', 'require("./.cleanup-tools/tests/release/prune-images.cjs"); console.log("trusted cleanup loaded");'], {cwd: directory, encoding: 'utf8'});
    assert.match(result, /trusted cleanup loaded/);
});

test('retention policy preserves minimum of five releases even when all are older than 90 days', () => {
    const baseDate = new Date('2026-06-01T00:00:00Z').getTime();
    const releases = [];
    const assets = {};
    const versions = [];
    for (let i = 1; i <= 5; i++) {
        const v = `1.9.${i}`;
        const assetId = 100 + i;
        const d = digest(String(i));
        const published_at = new Date(baseDate - (90 + i * 10) * 24 * 60 * 60 * 1000).toISOString();
        releases.push({tag_name: `v${v}`, published_at, assets: [{id: assetId, name: 'images.json'}]});
        assets[assetId] = {schema: 1, platform: 'linux/amd64', version: v,
            images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: d}]))};
        versions.push({id: i, name: d, created_at: published_at});
    }
    versions.push({id: 99, name: digest('f'), created_at: new Date(baseDate - 30 * 24 * 60 * 60 * 1000).toISOString()});

    const {calls, execute} = mockApi({
        releases,
        assets,
        packageVersions: () => [versions]
    });
    prune(execute, {now: baseDate});
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 3);
    for (const args of deletions) assert.match(args.at(-1), /\/versions\/99$/);
});

test('retention policy preserves all recent releases when more than five releases are within 90 days', () => {
    const baseDate = new Date('2026-06-01T00:00:00Z').getTime();
    const releases = [];
    const assets = {};
    const versions = [];
    for (let i = 1; i <= 7; i++) {
        const v = `1.9.${i}`;
        const assetId = 100 + i;
        const d = digest(String(i));
        const published_at = new Date(baseDate - i * 10 * 24 * 60 * 60 * 1000).toISOString();
        releases.push({tag_name: `v${v}`, published_at, assets: [{id: assetId, name: 'images.json'}]});
        assets[assetId] = {schema: 1, platform: 'linux/amd64', version: v,
            images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: d}]))};
        versions.push({id: i, name: d, created_at: published_at});
    }
    versions.push({id: 99, name: digest('0'), created_at: new Date(baseDate - 20 * 24 * 60 * 60 * 1000).toISOString()});

    const {calls, execute} = mockApi({
        releases,
        assets,
        packageVersions: () => [versions]
    });
    prune(execute, {now: baseDate});
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 3);
    for (const args of deletions) assert.match(args.at(-1), /\/versions\/99$/);
});

test('retention boundaries prune releases beyond top 5 and older than 90 days when safe', () => {
    const baseDate = new Date('2026-06-01T00:00:00Z').getTime();
    const releases = [];
    const assets = {};
    const versions = [];
    for (let i = 1; i <= 7; i++) {
        const v = `1.9.${i}`;
        const assetId = 100 + i;
        const d = digest(String(i));
        const ageDays = (8 - i) <= 2 ? (8 - i) * 10 : 80 + (8 - i) * 10;
        const published_at = new Date(baseDate - ageDays * 24 * 60 * 60 * 1000).toISOString();
        const expired = i <= 2;
        releases.push({tag_name: `v${v}`, published_at, assets: [{id: assetId, name: 'images.json'}]});
        assets[assetId] = {schema: 1, platform: 'linux/amd64', version: v, expired,
            images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: d}]))};
        versions.push({id: i, name: d, created_at: published_at});
    }
    const {calls, execute} = mockApi({
        releases,
        assets,
        packageVersions: () => [versions]
    });
    prune(execute, {now: baseDate});
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 6);
    for (const args of deletions) assert.match(args.at(-1), /\/versions\/[12]$/);
});

test('explicitly pinned release is retained regardless of age or rank', () => {
    const baseDate = new Date('2026-06-01T00:00:00Z').getTime();
    const releases = [];
    const assets = {};
    const versions = [];
    for (let i = 1; i <= 7; i++) {
        const v = `1.9.${i}`;
        const assetId = 100 + i;
        const d = digest(String(i));
        const ageDays = (8 - i) <= 2 ? (8 - i) * 10 : 80 + (8 - i) * 10;
        const published_at = new Date(baseDate - ageDays * 24 * 60 * 60 * 1000).toISOString();
        const expired = i <= 2;
        releases.push({tag_name: `v${v}`, published_at, assets: [{id: assetId, name: 'images.json'}]});
        assets[assetId] = {schema: 1, platform: 'linux/amd64', version: v, expired,
            images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: d}]))};
        versions.push({id: i, name: d, created_at: published_at});
    }
    const {calls, execute} = mockApi({
        releases,
        assets,
        packageVersions: () => [versions]
    });
    prune(execute, {now: baseDate, pinned: ['v1.9.2']});
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 3);
    for (const args of deletions) assert.match(args.at(-1), /\/versions\/1$/);
});

test('unreferenced candidate images respect the 14-day grace period', () => {
    const baseDate = new Date('2026-06-01T00:00:00Z').getTime();
    const activeDigest = digest('a');
    const freshDigest = digest('1');
    const staleDigest = digest('2');
    const timelessDigest = digest('3');

    const versions = [
        {id: 1, name: activeDigest, created_at: '2026-05-01T00:00:00Z'},
        {id: 2, name: freshDigest, created_at: new Date(baseDate - 10 * 24 * 60 * 60 * 1000).toISOString()},
        {id: 3, name: staleDigest, created_at: new Date(baseDate - 20 * 24 * 60 * 60 * 1000).toISOString()},
        {id: 4, name: timelessDigest}
    ];

    const obsolete = obsoleteVersions(versions, [activeDigest], [activeDigest], {now: baseDate});
    assert.deepEqual(obsolete, [3, 4]);
});

test('shared digest is never deleted while any protected release references it', () => {
    const baseDate = new Date('2026-06-01T00:00:00Z').getTime();
    const sharedPhpDigest = digest('a');
    const uniqueProtectedCypress = digest('b');
    const uniqueExpiredCypress = digest('c');
    const sharedPlaywright = digest('d');

    const releases = [
        {tag_name: 'v1.9.6', published_at: new Date(baseDate - 10 * 24 * 60 * 60 * 1000).toISOString(), assets: [{id: 196, name: 'images.json'}]},
        {tag_name: 'v1.9.5', published_at: new Date(baseDate - 20 * 24 * 60 * 60 * 1000).toISOString(), assets: [{id: 195, name: 'images.json'}]},
        {tag_name: 'v1.9.4', published_at: new Date(baseDate - 30 * 24 * 60 * 60 * 1000).toISOString(), assets: [{id: 194, name: 'images.json'}]},
        {tag_name: 'v1.9.3', published_at: new Date(baseDate - 40 * 24 * 60 * 60 * 1000).toISOString(), assets: [{id: 193, name: 'images.json'}]},
        {tag_name: 'v1.9.2', published_at: new Date(baseDate - 50 * 24 * 60 * 60 * 1000).toISOString(), assets: [{id: 192, name: 'images.json'}]},
        {tag_name: 'v1.9.1', published_at: new Date(baseDate - 150 * 24 * 60 * 60 * 1000).toISOString(), assets: [{id: 191, name: 'images.json'}]}
    ];

    const assets = {
        196: {schema: 1, platform: 'linux/amd64', version: '1.9.6', images: {
            php: {inputs: inputs(root, 'php'), digest: sharedPhpDigest},
            'runner-cypress': {inputs: inputs(root, 'runner-cypress'), digest: uniqueProtectedCypress},
            'runner-playwright': {inputs: inputs(root, 'runner-playwright'), digest: sharedPlaywright}
        }},
        195: {schema: 1, platform: 'linux/amd64', version: '1.9.5', images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: digest('5')}]))},
        194: {schema: 1, platform: 'linux/amd64', version: '1.9.4', images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: digest('4')}]))},
        193: {schema: 1, platform: 'linux/amd64', version: '1.9.3', images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: digest('3')}]))},
        192: {schema: 1, platform: 'linux/amd64', version: '1.9.2', images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: digest('2')}]))},
        191: {schema: 1, platform: 'linux/amd64', version: '1.9.1', expired: true, images: {
            php: {inputs: inputs(root, 'php'), digest: sharedPhpDigest},
            'runner-cypress': {inputs: inputs(root, 'runner-cypress'), digest: uniqueExpiredCypress},
            'runner-playwright': {inputs: inputs(root, 'runner-playwright'), digest: sharedPlaywright}
        }}
    };

    const phpVersions = [{id: 1, name: sharedPhpDigest}];
    const cypressVersions = [{id: 10, name: uniqueProtectedCypress}, {id: 11, name: uniqueExpiredCypress, created_at: '2025-01-01T00:00:00Z'}];
    const playwrightVersions = [{id: 20, name: sharedPlaywright}];

    const {calls, execute} = mockApi({
        releases,
        assets,
        packageVersions: endpoint => {
            if (endpoint.includes('php')) return [phpVersions];
            if (endpoint.includes('runner-cypress')) return [cypressVersions];
            return [playwrightVersions];
        }
    });

    prune(execute, {now: baseDate});
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 1);
    assert.match(deletions[0].at(-1), /runner-cypress\/versions\/11$/);
});

test('unexpired manifest on an older release preserves its images because safe expiration cannot be established', () => {
    const baseDate = new Date('2026-06-01T00:00:00Z').getTime();
    const releases = [];
    const assets = {};
    const versions = [];
    for (let i = 1; i <= 6; i++) {
        const v = `1.9.${i}`;
        const assetId = 100 + i;
        const d = digest(String(i));
        const ageDays = (7 - i) <= 1 ? (7 - i) * 10 : 80 + (7 - i) * 10;
        const published_at = new Date(baseDate - ageDays * 24 * 60 * 60 * 1000).toISOString();
        releases.push({tag_name: `v${v}`, published_at, assets: [{id: assetId, name: 'images.json'}]});
        assets[assetId] = {schema: 1, platform: 'linux/amd64', version: v, expired: false,
            images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: d}]))};
        versions.push({id: i, name: d, created_at: published_at});
    }
    const {calls, execute} = mockApi({
        releases,
        assets,
        packageVersions: () => [versions]
    });
    prune(execute, {now: baseDate});
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 0);
});
