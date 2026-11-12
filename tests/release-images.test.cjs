// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {kinds, inputs, platforms, resolve} = require('../bin/image-inputs.cjs');
const {manifest} = require('./release/images.cjs');
const {obsoleteVersions, prune} = require('./release/prune-images.cjs');
const digest = letter => 'sha256:' + letter.repeat(64);
const root = path.join(__dirname, '..');
const now = Date.parse('2026-06-01T00:00:00Z');
const oldImage = (id, name) => ({id, name, created_at: '2025-01-01T00:00:00Z'});
const published = {schema: 1, platform: 'linux/amd64', version: require('../package.json').version,
    images: Object.fromEntries(kinds.map(kind => [kind, {inputs: inputs(root, kind), digest: digest('a')}]))};

test('retention keeps the published digest even when a newer failed candidate exists', () => {
    assert.deepEqual(obsoleteVersions([oldImage(1, digest('0')), oldImage(2, digest('a')), oldImage(3, digest('b'))], digest('a'), digest('a'), {now}), [1, 3]);
    assert.throws(() => obsoleteVersions([{id: 1, name: digest('b')}], digest('a')), /Published image missing/);
    assert.throws(() => obsoleteVersions([{id: '../wrong', name: digest('a')}], digest('a')), /Invalid/);
});
function mockApi(overrides = {}) {
    const calls = [];
    const release = {id: 1, tag_name: `v${published.version}`, published_at: overrides.published_at || '2026-06-01T00:00:00Z', assets: [{id: 123, name: 'images.json'}]};
    const releases = structuredClone(overrides.releases || (overrides.noManifest ? [] : [release, ...(overrides.historicalReleases || [])]));
    const assets = structuredClone(overrides.assets || {});
    const execute = (args, input) => {
        calls.push(args);
        if (args.includes('DELETE')) return '';
        const endpoint = args.at(-1);
        if (args.includes('POST')) {
            if (overrides.uploadFailure) throw new Error('Expiration upload failed (HTTP 403)');
            const releaseId = Number(endpoint.match(/releases\/(\d+)\/assets/)[1]);
            const target = releases.find(r => r.id === releaseId);
            assert.ok(target, 'Expiration must target the correct release ID');
            const asset = {id: 10000 + releaseId, name: 'images-expired.json'};
            assets[asset.id] = JSON.parse(input);
            target.assets.push(asset);
            return JSON.stringify(asset);
        }
        if (args.includes('PATCH')) {
            if (overrides.renameFailure) throw new Error('Expiration rename failed (HTTP 403)');
            const assetId = Number(endpoint.split('/').at(-1));
            const asset = releases.flatMap(r => r.assets).find(a => a.id === assetId);
            asset.name = args.find(arg => arg.startsWith('name=')).slice(5);
            return JSON.stringify(asset);
        }
        if (endpoint.includes('/contents/')) {
            if (overrides.sourceFailure) throw new Error('Installer lookup failed (HTTP 503)');
            const file = endpoint.split('/contents/')[1].split('?')[0];
            return overrides.expirationCapable ? fs.readFileSync(path.join(root, file), 'utf8') : 'historical installer without expiration support';
        }
        if (endpoint.includes('/releases/tags/')) {
            if (overrides.readbackFailure) throw new Error('Expiration readback failed (HTTP 503)');
            return JSON.stringify(releases.find(r => r.tag_name === endpoint.split('/').at(-1)));
        }
        if (endpoint.endsWith('/releases/latest')) {
            return JSON.stringify({tag_name: overrides.latestTag || [...releases].sort((a, b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0) || b.tag_name.localeCompare(a.tag_name, undefined, {numeric: true}))[0]?.tag_name});
        }
        if (endpoint.includes('/releases?')) {
            if (overrides.networkFailure) throw new Error('Network unavailable');
            return JSON.stringify([releases]);
        }
        if (endpoint.includes('/releases/assets/')) {
            if (overrides.assetFailure) throw new Error('Asset download failed');
            const assetId = Number(endpoint.split('/').at(-1));
            if (overrides.failedAsset === assetId) throw new Error('Asset download failed (HTTP 503)');
            const data = assets[assetId] || published;
            return typeof data === 'string' ? data : JSON.stringify(data);
        }
        if (endpoint.includes('/versions?')) {
            if (overrides.packageVersions) return JSON.stringify(overrides.packageVersions(endpoint));
            return JSON.stringify([[oldImage(1, overrides.missingLatest ? digest('c') : digest('a'))], [oldImage(2, digest('b')), oldImage(3, digest('0'))]]);
        }
        return JSON.stringify({repository: {full_name: overrides.otherRepository ? 'Other/Project' : 'MageLens/MageLens'}});
    };
    return {calls, execute};
}
test('cleanup paginates all three allowlisted packages and deletes only obsolete versions', () => {
    const {calls, execute} = mockApi();
    prune(execute, {now});
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 6);
    for (const args of deletions) assert.match(args.at(-1), /^orgs\/MageLens\/packages\/container\/(php|runner-cypress|runner-playwright)\/versions\/[23]$/);
    assert.equal(calls.filter(args => args.includes('--paginate')).length, 4);
});
for (const failure of ['networkFailure', 'otherRepository', 'missingLatest']) {
    test(`cleanup refuses all deletion after ${failure}`, () => {
        const {calls, execute} = mockApi({[failure]: true});
        assert.throws(() => prune(execute, {now}));
        assert.equal(calls.filter(args => args.includes('DELETE')).length, 0);
    });
}
test('first image publication retains only one candidate per package for public visibility setup', () => {
    const {calls, execute} = mockApi({noManifest: true});
    prune(execute, {now});
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 6);
    for (const args of deletions) assert.match(args.at(-1), /\/versions\/[12]$/);
});
test('cleanup retains historical release images across versions while deleting failed candidates', () => {
    const historicalReleases = [{tag_name: 'v1.9.2', assets: [{id: 124, name: 'images.json'}]}];
    const historicalManifest = {schema: 1, platform: 'linux/amd64', version: '1.9.2',
        images: Object.fromEntries(kinds.map(kind => [kind, {inputs: inputs(root, kind), digest: digest('b')}]))};
    const {calls, execute} = mockApi({historicalReleases, assets: {124: historicalManifest}});
    prune(execute, {now});
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 3);
    for (const args of deletions) assert.match(args.at(-1), /^orgs\/MageLens\/packages\/container\/(php|runner-cypress|runner-playwright)\/versions\/3$/);
});
test('cleanup allows only the exact historical images known to have been purged', () => {
    const historicalReleases = [{tag_name: 'v1.9.2', assets: [{id: 124, name: 'images.json'}]}];
    const missing = require('./release/legacy-missing-images.json')['1.9.2']['linux/amd64'];
    const historicalManifest = {schema: 1, platform: 'linux/amd64', version: '1.9.2',
        images: Object.fromEntries(kinds.map(kind => [kind, {inputs: inputs(root, kind), digest: missing[kind]}]))};
    const {calls, execute} = mockApi({historicalReleases, assets: {124: historicalManifest}});
    prune(execute, {now});
    const deletions = calls.filter(args => args.includes('DELETE'));
    assert.equal(deletions.length, 6);
    for (const args of deletions) assert.match(args.at(-1), /\/versions\/[23]$/);
    for (const kind of kinds) {
        const changed = structuredClone(historicalManifest);
        changed.images[kind].digest = digest('9');
        const api = mockApi({historicalReleases, assets: {124: changed}});
        assert.throws(() => prune(api.execute, {now}), /Published image missing/);
        assert.equal(api.calls.filter(args => args.includes('DELETE')).length, 0);
    }
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
    const versions = ['a', 'b', 'c'].map((letter, index) => oldImage(index + 1, digest(letter)));
    assert.deepEqual(obsoleteVersions(versions, [digest('a'), digest('b')]), [3]);
    assert.throws(() => obsoleteVersions(versions, [digest('a'), digest('d')]), /Published image missing/);
});
test('cleanup retains both native digests from the extended manifest', () => {
    const legacy = mockApi();
    prune(args => {
        if (args.at(-1).includes('/releases/assets/')) return JSON.stringify({schema: 1, platform: 'linux/amd64', images: published.images, version: published.version,
            platforms: {'linux/amd64': published.images, 'linux/arm64': Object.fromEntries(kinds.map(kind => [kind, {...published.images[kind], digest: digest('b')}]))}});
        return legacy.execute(args);
    }, {now});
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
    assert.throws(() => prune(execute, {now}), /Protected release v1.9.4 is missing images.json manifest; refusing cleanup/);
    assert.equal(calls.filter(args => args.includes('DELETE')).length, 0);
});

test('cleanup aborts with zero DELETE requests when a protected release manifest is invalid', () => {
    const releases = [{tag_name: 'v1.9.4', published_at: '2026-06-01T00:00:00Z', assets: [{id: 194, name: 'images.json'}]}];
    const invalidManifest = {schema: 1, platform: 'linux/amd64', version: '1.9.4', images: {php: {inputs: 'invalid', digest: 'invalid'}}};
    const {calls, execute} = mockApi({releases, assets: {194: invalidManifest}});
    assert.throws(() => prune(execute, {now}), /provenance/);
    assert.equal(calls.filter(args => args.includes('DELETE')).length, 0);
});

test('cleanup aborts with zero DELETE requests when protected release asset API fails', () => {
    const releases = [{tag_name: 'v1.9.4', published_at: '2026-06-01T00:00:00Z', assets: [{id: 194, name: 'images.json'}]}];
    const {calls, execute} = mockApi({releases, assetFailure: true});
    assert.throws(() => prune(execute, {now}), /Asset download failed/);
    assert.equal(calls.filter(args => args.includes('DELETE')).length, 0);
});

test('cleanup does not require manifests for releases that predate prebuilt-image support (< 1.9.0)', () => {
    const releases = [
        {tag_name: `v${published.version}`, published_at: '2026-06-01T00:00:00Z', assets: [{id: 123, name: 'images.json'}]},
        {tag_name: 'v1.8.9', published_at: '2025-01-01T00:00:00Z', assets: []}
    ];
    const {calls, execute} = mockApi({releases});
    prune(execute, {now});
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
    fs.copyFileSync(path.join(root, 'tests/release/legacy-missing-images.json'), path.join(directory, '.cleanup-tools/tests/release/legacy-missing-images.json'));
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
        releases.push({id: assetId, tag_name: `v${v}`, published_at, assets: [{id: assetId, name: 'images.json'}]});
        assets[assetId] = {schema: 1, platform: 'linux/amd64', version: v,
            images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: d}]))};
        versions.push({id: i, name: d, created_at: published_at});
    }
    versions.push({id: 99, name: digest('f'), created_at: new Date(baseDate - 30 * 24 * 60 * 60 * 1000).toISOString()});

    const {calls, execute} = mockApi({
        releases,
        assets,
        expirationCapable: true,
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
        releases.push({id: assetId, tag_name: `v${v}`, published_at, assets: [{id: assetId, name: 'images.json'}]});
        assets[assetId] = {schema: 1, platform: 'linux/amd64', version: v,
            images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: d}]))};
        versions.push({id: i, name: d, created_at: published_at});
    }
    versions.push({id: 99, name: digest('0'), created_at: new Date(baseDate - 20 * 24 * 60 * 60 * 1000).toISOString()});

    const {calls, execute} = mockApi({
        releases,
        assets,
        expirationCapable: true,
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
        const expired = false;
        releases.push({id: assetId, tag_name: `v${v}`, published_at, assets: [{id: assetId, name: 'images.json'}]});
        assets[assetId] = {schema: 1, platform: 'linux/amd64', version: v, expired,
            images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: d}]))};
        versions.push({id: i, name: d, created_at: published_at});
    }
    const {calls, execute} = mockApi({
        releases,
        assets,
        expirationCapable: true,
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
        const expired = false;
        releases.push({id: assetId, tag_name: `v${v}`, published_at, assets: [{id: assetId, name: 'images.json'}]});
        assets[assetId] = {schema: 1, platform: 'linux/amd64', version: v, expired,
            images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: d}]))};
        versions.push({id: i, name: d, created_at: published_at});
    }
    const {calls, execute} = mockApi({
        releases,
        assets,
        expirationCapable: true,
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

    const versions = [
        {id: 1, name: activeDigest, created_at: '2026-05-01T00:00:00Z'},
        {id: 2, name: freshDigest, created_at: new Date(baseDate - 10 * 24 * 60 * 60 * 1000).toISOString()},
        {id: 3, name: staleDigest, created_at: new Date(baseDate - 20 * 24 * 60 * 60 * 1000).toISOString()}
    ];

    const obsolete = obsoleteVersions(versions, [activeDigest], [activeDigest], {now: baseDate});
    assert.deepEqual(obsolete, [3]);
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

    const historicalVersions = ['2', '3', '4', '5'].map((letter, index) => oldImage(30 + index, digest(letter)));
    const phpVersions = [{id: 1, name: sharedPhpDigest}, ...historicalVersions];
    const cypressVersions = [{id: 10, name: uniqueProtectedCypress}, {id: 11, name: uniqueExpiredCypress, created_at: '2025-01-01T00:00:00Z'}, ...historicalVersions];
    const playwrightVersions = [{id: 20, name: sharedPlaywright}, ...historicalVersions];

    const {calls, execute} = mockApi({
        releases,
        assets,
        expirationCapable: true,
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
        releases.push({id: assetId, tag_name: `v${v}`, published_at, assets: [{id: assetId, name: 'images.json'}]});
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

function retentionFixture() {
    const releases = [], assets = {}, inventories = Object.fromEntries(kinds.map(kind => [kind, []]));
    for (let i = 1; i <= 6; i++) {
        const version = `2.0.${i}`;
        const published_at = new Date(now - (7 - i) * 30 * 24 * 60 * 60 * 1000).toISOString();
        releases.push({id: i, tag_name: `v${version}`, published_at, assets: [{id: 100 + i, name: 'images.json'}]});
        const entries = Object.fromEntries(platforms.map((platform, p) => [platform, Object.fromEntries(kinds.map(kind => {
            const entry = {inputs: published.images[kind].inputs, digest: digest((i * 2 + p).toString(16))};
            inventories[kind].push(oldImage(i * 10 + p, entry.digest));
            return [kind, entry];
        }))]));
        assets[100 + i] = {schema: 1, version, platform: 'linux/amd64', images: entries['linux/amd64'], platforms: entries};
    }
    for (const kind of kinds) inventories[kind].push(oldImage(999, digest('0')));
    return {releases, assets, inventories, expirationCapable: true,
        packageVersions: endpoint => [inventories[endpoint.split('/container/')[1].split('/')[0]]]};
}
const mutations = calls => calls.filter(args => args.some(arg => ['DELETE', 'POST', 'PATCH'].includes(arg)));
const deletions = calls => calls.filter(args => args.includes('DELETE'));

for (const failure of ['503', 'missing', 'malformed JSON', 'invalid provenance', 'wrong version', 'invalid asset ID']) {
    test(`eligible oldest active manifest with ${failure} aborts the complete plan without mutations`, () => {
        const fixture = retentionFixture();
        if (failure === '503') fixture.failedAsset = 101;
        if (failure === 'missing') fixture.releases[0].assets = [];
        if (failure === 'malformed JSON') fixture.assets[101] = '{broken';
        if (failure === 'invalid provenance') fixture.assets[101].platforms['linux/arm64'].php.digest = 'invalid';
        if (failure === 'wrong version') fixture.assets[101].version = '2.0.99';
        if (failure === 'invalid asset ID') fixture.releases[0].assets[0].id = '../wrong';
        const api = mockApi(fixture);
        assert.throws(() => prune(api.execute, {now}));
        assert.deepEqual(mutations(api.calls), []);
    });
}

test('real expiration retires an ordinary active manifest, selects source builds and only then deletes unshared images', async t => {
    const fixture = retentionFixture();
    // Share an old PHP digest with a protected release on ARM64.
    const shared = fixture.assets[101].platforms['linux/arm64'].php.digest;
    fixture.assets[106].platforms['linux/arm64'].php.digest = shared;
    fixture.inventories.php = fixture.inventories.php.filter(image => image.id !== 61);
    const api = mockApi(fixture);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-expiration-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    for (const file of ['dependencies.yaml', '.dockerignore', 'bin', 'docker']) fs.cpSync(path.join(root, file), path.join(directory, file), {recursive: true});
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({version: '2.0.1'}));
    const request = async url => {
        assert.equal(url, 'https://github.com/MageLens/MageLens/releases/download/v2.0.1/images.json');
        const release = JSON.parse(api.execute(['repos/MageLens/MageLens/releases/tags/v2.0.1']));
        const id = release.assets.find(asset => asset.name === 'images.json').id;
        return {ok: true, status: 200, json: async () => JSON.parse(api.execute(['-H', 'Accept: application/octet-stream', `repos/MageLens/MageLens/releases/assets/${id}`]))};
    };
    for (const platform of platforms) for (const runner of ['cypress', 'playwright']) {
        const selected = await resolve(directory, {MAGELENS_IMAGE_PLATFORM: platform, MAGELENS_RUNNER: runner}, request);
        assert.ok(Object.values(selected).every(entry => entry?.image), 'Ordinary active manifest must select prebuilt images before expiration');
    }
    const retiredAtDeletion = [];
    prune((args, input) => {
        if (args.includes('DELETE')) {
            // Inspect the state at the first possible destructive operation.
            const response = JSON.parse(api.execute(['repos/MageLens/MageLens/releases/tags/v2.0.1']));
            const asset = response.assets.find(a => a.name === 'images.json');
            retiredAtDeletion.push(JSON.parse(api.execute([`repos/MageLens/MageLens/releases/assets/${asset.id}`])));
        }
        return api.execute(args, input);
    }, {now});
    assert.ok(retiredAtDeletion.length > 0);
    for (const retired of retiredAtDeletion) assert.deepEqual(retired, {...fixture.assets[101], expired: true});
    for (const platform of platforms) for (const runner of ['cypress', 'playwright']) {
        assert.deepEqual(await resolve(directory, {MAGELENS_IMAGE_PLATFORM: platform, MAGELENS_RUNNER: runner}, request), {php: null, [`runner-${runner}`]: null});
    }
    const removed = deletions(api.calls).map(args => args.at(-1));
    assert.ok(removed.includes('orgs/MageLens/packages/container/php/versions/10'));
    assert.ok(!removed.includes('orgs/MageLens/packages/container/php/versions/11'), 'Shared protected digest must survive');
    assert.equal(removed.length, 8);
    const backup = JSON.parse(api.execute(['repos/MageLens/MageLens/releases/tags/v2.0.1'])).assets.find(a => a.name === 'images-retired-101.json');
    assert.deepEqual(JSON.parse(api.execute([`repos/MageLens/MageLens/releases/assets/${backup.id}`])), fixture.assets[101]);
    assert.ok(!api.calls.some(args => args.some(arg => arg.includes('/git/refs'))), 'Historical tags must never change');
    const uploadsBefore = api.calls.filter(args => args.includes('POST')).length;
    prune(api.execute, {now});
    assert.equal(api.calls.filter(args => args.includes('POST')).length, uploadsBefore, 'Already expired manifests need no replacement');
});

for (const failure of ['sourceFailure', 'uploadFailure', 'renameFailure', 'readbackFailure']) {
    test(`expiration ${failure} fails distinctly and makes zero DELETE requests`, () => {
        const api = mockApi({...retentionFixture(), [failure]: true});
        assert.throws(() => prune(api.execute, {now}), /failed \(HTTP (403|503)\)/);
        assert.deepEqual(deletions(api.calls), []);
        if (failure === 'sourceFailure') assert.deepEqual(mutations(api.calls), []);
    });
}

for (const kind of kinds) for (const platform of platforms) {
    test(`missing protected non-latest ${platform} ${kind} blocks deletion of unrelated orphans`, () => {
        const fixture = retentionFixture();
        const missing = fixture.assets[105].platforms[platform][kind].digest;
        fixture.inventories[kind] = fixture.inventories[kind].filter(image => image.name !== missing);
        const api = mockApi(fixture);
        assert.throws(() => prune(api.execute, {now}), /Published image missing/);
        assert.deepEqual(mutations(api.calls), []);
    });
}

for (const timestamp of [undefined, null, '', 'not-a-date', '2026-02-30T00:00:00Z', '1']) {
    test(`unknown candidate creation time (${JSON.stringify(timestamp)}) blocks the complete plan`, () => {
        const fixture = retentionFixture();
        // Put it in the final package so earlier valid deletion candidates have
        // already been planned; none may be executed, including expiration.
        fixture.inventories['runner-playwright'].at(-1).created_at = timestamp;
        const api = mockApi(fixture);
        assert.throws(() => prune(api.execute, {now}), /Unknown image creation time/);
        assert.deepEqual(mutations(api.calls), []);
    });
}

test('injected clock keeps young candidates and expires them at the exact 14-day boundary', () => {
    const boundary = now - 14 * 24 * 60 * 60 * 1000;
    const versions = [
        {id: 1, name: digest('1'), created_at: new Date(boundary + 1).toISOString()},
        {id: 2, name: digest('2'), created_at: new Date(boundary).toISOString()},
        {id: 3, name: digest('3'), created_at: new Date(boundary - 1).toISOString()},
        {id: 4, name: digest('4'), created_at: new Date(now + 1).toISOString()}
    ];
    assert.deepEqual(obsoleteVersions(versions, [], [], {now}), [2, 3]);
    assert.deepEqual(obsoleteVersions(versions, [], [], {now: now - 1}), [3]);
});

test('latest release remains protected outside the five newest publication dates and 90 days', () => {
    const fixture = retentionFixture();
    const api = mockApi({...fixture, latestTag: 'v2.0.1'});
    prune(api.execute, {now});
    assert.ok(deletions(api.calls).every(args => args.at(-1).endsWith('/versions/999')));
    assert.equal(deletions(api.calls).length, 3);
    assert.ok(!api.calls.some(args => args.includes('POST')));
});

test('90-day retention boundary preserves an otherwise eligible release until the boundary passes', () => {
    const fixture = retentionFixture();
    fixture.releases[0].published_at = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    // Keep five newer releases, so age is the only protection for the oldest.
    for (let i = 1; i < fixture.releases.length; i++) fixture.releases[i].published_at = new Date(now - (90 - i) * 24 * 60 * 60 * 1000).toISOString();
    const api = mockApi(fixture);
    prune(api.execute, {now});
    assert.ok(!api.calls.some(args => args.includes('POST')));
    const expired = mockApi(fixture);
    prune(expired.execute, {now: now + 1});
    assert.equal(expired.calls.filter(args => args.includes('POST')).length, 1);
});

for (const file of ['bin/image-inputs.cjs', 'bin/prepare-images']) {
    test(`unrecognized tagged ${file} preserves historical images without rewriting the manifest`, () => {
        const api = mockApi(retentionFixture());
        prune((args, input) => args.at(-1).includes(`/contents/${file}?`) ? 'unrecognized historical implementation' : api.execute(args, input), {now});
        assert.equal(deletions(api.calls).length, 3);
        assert.ok(deletions(api.calls).every(args => args.at(-1).endsWith('/versions/999')));
        assert.ok(!api.calls.some(args => args.includes('POST') || args.includes('PATCH')));
    });
}

for (const corruption of ['upload content', 'rename acknowledgement', 'canonical asset']) {
    test(`expiration with incorrect ${corruption} aborts before image deletion`, () => {
        const api = mockApi(retentionFixture());
        assert.throws(() => prune((args, input) => {
            const result = api.execute(args, input);
            if (corruption === 'upload content' && args.at(-1).endsWith('/assets/10001')) return JSON.stringify({...JSON.parse(result), expired: false});
            if (corruption === 'rename acknowledgement' && args.includes('PATCH')) return JSON.stringify({...JSON.parse(result), name: 'wrong.json'});
            if (corruption === 'canonical asset' && args.at(-1).includes('/releases/tags/')) return JSON.stringify({...JSON.parse(result), assets: []});
            return result;
        }, {now}), /Expiration|Expired/);
        assert.deepEqual(deletions(api.calls), []);
    });
}

test('all exact legacy exceptions retain available digests and never apply to the latest release', () => {
    const exceptions = require('./release/legacy-missing-images.json');
    for (const [version, entries] of Object.entries(exceptions)) {
        const images = Object.fromEntries(kinds.map(kind => [kind, {inputs: published.images[kind].inputs, digest: entries['linux/amd64'][kind]}]));
        const historical = {schema: 1, version, platform: 'linux/amd64', images};
        const options = {historicalReleases: [{tag_name: `v${version}`, assets: [{id: 124, name: 'images.json'}]}], assets: {124: historical}};
        const absent = mockApi(options);
        prune(absent.execute, {now});
        assert.equal(deletions(absent.calls).length, 6);
        const present = mockApi({...options, packageVersions: endpoint => {
            const kind = endpoint.split('/container/')[1].split('/')[0];
            return [[oldImage(1, digest('a')), oldImage(2, images[kind].digest), oldImage(3, digest('0'))]];
        }});
        prune(present.execute, {now});
        assert.ok(deletions(present.calls).every(args => args.at(-1).endsWith('/versions/3')));
        assert.equal(deletions(present.calls).length, 3);
        const latest = mockApi({...options, latestTag: `v${version}`});
        assert.throws(() => prune(latest.execute, {now}), /Published image missing/);
        assert.deepEqual(mutations(latest.calls), []);
    }
});
