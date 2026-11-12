// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const {kinds, inputs, platforms, resolve, repository, repositoryUrl, manifestFilename, expirationProtocol} = require('../bin/image-inputs.cjs');
const {manifest} = require('./release/images.cjs');
const {obsoleteVersions, prune, RETIREMENT_GRACE_PERIOD_MS} = require('./release/prune-images.cjs');
const {
    digest, root, now, oldImage, dayMs, releasesEndpoint, packagesEndpoint,
    packageKind, published, retentionFixture, mockApi
} = require('./release/image-fixtures.cjs');
const expirationApiErrorPattern = /failed \(HTTP (403|503)\)/;
const expirationVerificationErrorPattern = /Expiration|Expired/;
const deleteRequests = calls => calls.filter(args => args.includes('DELETE'));
const mutations = calls => calls.filter(args => args.some(arg => ['DELETE', 'POST', 'PATCH'].includes(arg)));

function assertDeletions(calls, ids, packages = kinds) {
    const actual = deleteRequests(calls).map(args => args.at(-1)).sort();
    const expected = packages.flatMap(kind => ids.map(id => `${packagesEndpoint}/${kind}/versions/${id}`)).sort();
    assert.deepEqual(actual, expected);
}
test('retention keeps the published digest even when a newer failed candidate exists', () => {
    assert.deepEqual(obsoleteVersions([oldImage(1, digest('0')), oldImage(2, digest('a')), oldImage(3, digest('b'))], digest('a'), digest('a'), {now}), [1, 3]);
    assert.throws(() => obsoleteVersions([{id: 1, name: digest('b')}], digest('a')), /Published image missing/);
    assert.throws(() => obsoleteVersions([{id: '../wrong', name: digest('a')}], digest('a')), /Invalid/);
});

test('image builder keeps publication restricted to the configured repository and manual workflow', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-publish-guard-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    for (const file of ['dependencies.yaml', 'bin/common', 'bin/dependencies', 'bin/image-inputs.cjs', 'tests/release/build-images.sh']) {
        const destination = path.join(directory, file);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.copyFileSync(path.join(root, file), destination);
    }
    const commands = path.join(directory, 'commands');
    const log = path.join(directory, 'docker-called');
    fs.mkdirSync(commands);
    // Stop at the first Docker call; this test cannot build or publish images.
    fs.writeFileSync(path.join(commands, 'docker'), '#!/bin/sh\ntouch "$MOCK_DOCKER_LOG"\nexit 77\n', {mode: 0o755});
    const cases = [
        {mode: 'publish', repo: 'Other/Project', event: 'workflow_dispatch', allowed: false},
        {mode: 'publish', repo: repository, event: 'pull_request', allowed: false},
        {mode: 'invalid', repo: repository, event: 'workflow_dispatch', allowed: false},
        {mode: 'publish', repo: repository, event: 'workflow_dispatch', allowed: true},
        {mode: 'test', repo: 'Other/Project', event: 'pull_request', allowed: true}
    ];
    for (const {mode, repo, event, allowed} of cases) {
        fs.rmSync(log, {force: true});
        const result = spawnSync('bash', ['tests/release/build-images.sh', mode], {
            cwd: directory, encoding: 'utf8', env: {
                ...process.env, PATH: `${commands}:${process.env.PATH}`, MOCK_DOCKER_LOG: log,
                GITHUB_REPOSITORY: repo, GITHUB_EVENT_NAME: event
            }
        });
        assert.equal(result.status, allowed ? 77 : 1, result.stderr);
        assert.equal(fs.existsSync(log), allowed, 'Rejected publication must stop before Docker');
    }
});
test('cleanup paginates all three allowlisted packages and deletes only obsolete versions', () => {
    const {calls, execute} = mockApi();
    prune(execute, {now});
    assertDeletions(calls, [2, 3]);
    assert.equal(calls.filter(args => args.includes('--paginate')).length, 4);
});
for (const failure of ['networkFailure', 'otherRepository', 'missingLatest']) {
    test(`cleanup refuses all deletion after ${failure}`, () => {
        const {calls, execute} = mockApi({[failure]: true});
        assert.throws(() => prune(execute, {now}));
        assert.equal(deleteRequests(calls).length, 0);
    });
}
test('first image publication retains only one candidate per package for public visibility setup', () => {
    const {calls, execute} = mockApi({noManifest: true});
    prune(execute, {now});
    assertDeletions(calls, [1, 2]);
});
test('cleanup retains historical release images across versions while deleting failed candidates', () => {
    const historicalReleases = [{tag_name: 'v1.9.2', assets: [{id: 124, name: manifestFilename}]}];
    const historicalManifest = {schema: 1, platform: 'linux/amd64', version: '1.9.2',
        images: Object.fromEntries(kinds.map(kind => [kind, {inputs: inputs(root, kind), digest: digest('b')}]))};
    const {calls, execute} = mockApi({historicalReleases, assets: {124: historicalManifest}});
    prune(execute, {now});
    assertDeletions(calls, [3]);
});
test('cleanup allows only the exact historical images known to have been purged', () => {
    const historicalReleases = [{tag_name: 'v1.9.2', assets: [{id: 124, name: manifestFilename}]}];
    const missing = require('./release/legacy-missing-images.json')['1.9.2']['linux/amd64'];
    const historicalManifest = {schema: 1, platform: 'linux/amd64', version: '1.9.2',
        images: Object.fromEntries(kinds.map(kind => [kind, {inputs: inputs(root, kind), digest: missing[kind]}]))};
    const {calls, execute} = mockApi({historicalReleases, assets: {124: historicalManifest}});
    prune(execute, {now});
    assertDeletions(calls, [2, 3]);
    for (const kind of kinds) {
        const changed = structuredClone(historicalManifest);
        changed.images[kind].digest = digest('9');
        const api = mockApi({historicalReleases, assets: {124: changed}});
        assert.throws(() => prune(api.execute, {now}), /Published image missing/);
        assert.equal(deleteRequests(api.calls).length, 0);
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
    assert.deepEqual(manifest(directory, root, env), {schema: 1, expirationProtocol, platform: 'linux/amd64', images: published.images, version: published.version,
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
    assertDeletions(legacy.calls, [3]);
});

test('reproduction: protected release without manifest aborts cleanup before any DELETE request', () => {
    // Reproduction:
    // - v1.9.4 has no manifest, but its six images exist.
    // - v1.9.3 has a valid manifest and six images.
    // Cleanup must throw and make zero DELETE requests.
    const releases = [
        {tag_name: 'v1.9.4', published_at: '2026-06-01T00:00:00Z', assets: []},
        {tag_name: 'v1.9.3', published_at: '2026-05-01T00:00:00Z', assets: [{id: 193, name: manifestFilename}]}
    ];
    const manifest193 = {schema: 1, platform: 'linux/amd64', version: '1.9.3',
        images: Object.fromEntries(kinds.map(k => [k, {inputs: inputs(root, k), digest: digest('3')}]))};
    const {calls, execute} = mockApi({releases, assets: {193: manifest193}});
    assert.throws(() => prune(execute, {now}), /Protected release v1.9.4 is missing images.json manifest; refusing cleanup/);
    assert.equal(deleteRequests(calls).length, 0);
});

test('cleanup aborts with zero DELETE requests when a protected release manifest is invalid', () => {
    const releases = [{tag_name: 'v1.9.4', published_at: '2026-06-01T00:00:00Z', assets: [{id: 194, name: manifestFilename}]}];
    const invalidManifest = {schema: 1, platform: 'linux/amd64', version: '1.9.4', images: {php: {inputs: 'invalid', digest: 'invalid'}}};
    const {calls, execute} = mockApi({releases, assets: {194: invalidManifest}});
    assert.throws(() => prune(execute, {now}), /provenance/);
    assert.equal(deleteRequests(calls).length, 0);
});

test('cleanup aborts with zero DELETE requests when protected release asset API fails', () => {
    const releases = [{tag_name: 'v1.9.4', published_at: '2026-06-01T00:00:00Z', assets: [{id: 194, name: manifestFilename}]}];
    const {calls, execute} = mockApi({releases, assetFailure: true});
    assert.throws(() => prune(execute, {now}), /Asset download failed/);
    assert.equal(deleteRequests(calls).length, 0);
});

test('cleanup does not require manifests for releases that predate prebuilt-image support (< 1.9.0)', () => {
    const releases = [
        {tag_name: `v${published.version}`, published_at: '2026-06-01T00:00:00Z', assets: [{id: 123, name: manifestFilename}]},
        {tag_name: 'v1.8.9', published_at: '2025-01-01T00:00:00Z', assets: []}
    ];
    const {calls, execute} = mockApi({releases});
    prune(execute, {now});
    assertDeletions(calls, [2, 3]);
});

test('release workflow pins cleanup to trusted github.sha in .cleanup-tools separately from release checkout', () => {
    const workflowPath = path.join(root, '.github/workflows/release.yml');
    const workflowContent = fs.readFileSync(workflowPath, 'utf8');

    const trustedCleanupCheckoutPattern = /uses:\s*actions\/checkout@[^\n]+\n\s+with:\n\s+persist-credentials:\s*false\n\s+ref:\s*\$\{\{\s*github\.sha\s*\}\}\n\s+path:\s*\.cleanup-tools/g;
    const trustedCleanupCommandPattern = /node\s+\.cleanup-tools\/tests\/release\/prune-images\.cjs\s+&&\s+rm\s+-rf\s+\.cleanup-tools/g;
    const historicalCleanupCommandPattern = /run:\s*node\s+tests\/release\/prune-images\.cjs/;
    const checkoutMatches = [...workflowContent.matchAll(trustedCleanupCheckoutPattern)];
    assert.equal(checkoutMatches.length, 2, 'Both pre- and post-publication cleanups must checkout github.sha to .cleanup-tools');

    const runMatches = [...workflowContent.matchAll(trustedCleanupCommandPattern)];
    assert.equal(runMatches.length, 2, 'All cleanup invocations must execute from .cleanup-tools and remove it');

    assert.doesNotMatch(workflowContent, historicalCleanupCommandPattern);
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

    const result = execFileSync('node', ['-e', 'require("./.cleanup-tools/tests/release/prune-images.cjs"); console.log("trusted cleanup loaded");'], {cwd: directory, encoding: 'utf8'});
    assert.match(result, /trusted cleanup loaded/);
});

test('retention policy preserves minimum of five releases even when all are older than 90 days', () => {
    const api = mockApi(retentionFixture({count: 5, ageDays: i => 100 + i * 10}));
    prune(api.execute, {now});
    assertDeletions(api.calls, [999]);
});

test('retention policy preserves all recent releases when more than five releases are within 90 days', () => {
    const api = mockApi(retentionFixture({count: 7, ageDays: i => i * 10}));
    prune(api.execute, {now});
    assertDeletions(api.calls, [999]);
});

test('retention boundaries prune releases beyond top 5 and older than 90 days when safe', () => {
    const api = mockApi(retentionFixture({count: 7}));
    prune(api.execute, {now});
    assertDeletions(api.calls, [999]);
    prune(api.execute, {now: now + RETIREMENT_GRACE_PERIOD_MS});
    // Two expired releases, each with six native images, plus three orphans.
    assertDeletions(api.calls, [10, 11, 20, 21, 999]);
    assert.equal(api.calls.filter(args => args.includes('POST')).length, 2);
});

test('explicitly pinned release is retained regardless of age or rank', () => {
    const api = mockApi(retentionFixture({count: 7}));
    prune(api.execute, {now, pinned: ['v2.0.2']});
    assertDeletions(api.calls, [999]);
    prune(api.execute, {now: now + RETIREMENT_GRACE_PERIOD_MS, pinned: ['v2.0.2']});
    assertDeletions(api.calls, [10, 11, 999]);
    assert.equal(api.calls.filter(args => args.includes('POST')).length, 1);
});

test('unreferenced candidate images respect the 14-day grace period', () => {
    const baseDate = new Date('2026-06-01T00:00:00Z').getTime();
    const activeDigest = digest('a');
    const freshDigest = digest('1');
    const staleDigest = digest('2');

    const versions = [
        {id: 1, name: activeDigest, created_at: '2026-05-01T00:00:00Z'},
        {id: 2, name: freshDigest, created_at: new Date(baseDate - 10 * dayMs).toISOString()},
        {id: 3, name: staleDigest, created_at: new Date(baseDate - 20 * dayMs).toISOString()}
    ];

    const obsolete = obsoleteVersions(versions, [activeDigest], [activeDigest], {now: baseDate});
    assert.deepEqual(obsolete, [3]);
});

test('shared digest is never deleted while any protected release references it', () => {
    const fixture = retentionFixture();
    fixture.assets[101].expired = true;
    fixture.assets[101].expiredAt = new Date(now - RETIREMENT_GRACE_PERIOD_MS).toISOString();
    for (const kind of ['php', 'runner-playwright']) {
        for (const platform of platforms) {
            fixture.assets[106].platforms[platform][kind].digest = fixture.assets[101].platforms[platform][kind].digest;
        }
        fixture.inventories[kind] = fixture.inventories[kind].filter(image => ![60, 61].includes(image.id));
    }
    for (const kind of kinds) fixture.inventories[kind] = fixture.inventories[kind].filter(image => image.id !== 999);
    const api = mockApi(fixture);
    prune(api.execute, {now});
    assertDeletions(api.calls, [10, 11], ['runner-cypress']);
});

test('unexpired manifest on an older release preserves its images because safe expiration cannot be established', () => {
    const api = mockApi(retentionFixture({protocol: null}));
    prune(api.execute, {now});
    assertDeletions(api.calls, [999]);
    assert.ok(!api.calls.some(args => args.includes('POST') || args.includes('PATCH')));
});

const manifestFailures = {
    '503': fixture => {fixture.failedAsset = 101;},
    'missing': fixture => {fixture.releases[0].assets = [];},
    'malformed JSON': fixture => {fixture.assets[101] = '{broken';},
    'invalid provenance': fixture => {fixture.assets[101].platforms['linux/arm64'].php.digest = 'invalid';},
    'wrong version': fixture => {fixture.assets[101].version = '2.0.99';},
    'invalid asset ID': fixture => {fixture.releases[0].assets[0].id = '../wrong';}
};
for (const [failure, applyFailure] of Object.entries(manifestFailures)) {
    test(`eligible oldest active manifest with ${failure} aborts the complete plan without mutations`, () => {
        const fixture = retentionFixture();
        applyFailure(fixture);
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
        assert.equal(url, `${repositoryUrl}/releases/download/v2.0.1/${manifestFilename}`);
        const release = api.release('v2.0.1');
        const id = release.assets.find(asset => asset.name === manifestFilename).id;
        return {ok: true, status: 200, json: async () => api.asset(id)};
    };
    for (const platform of platforms) for (const runner of ['cypress', 'playwright']) {
        const selected = await resolve(directory, {MAGELENS_IMAGE_PLATFORM: platform, MAGELENS_RUNNER: runner}, request);
        assert.ok(Object.values(selected).every(entry => entry?.image), 'Ordinary active manifest must select prebuilt images before expiration');
    }
    prune(api.execute, {now});
    assertDeletions(api.calls, [999]);
    const retiredAtDeletion = [];
    prune((args, input) => {
        if (args.includes('DELETE')) {
            // Inspect the state at the first possible destructive operation.
            const response = api.release('v2.0.1');
            const asset = response.assets.find(a => a.name === manifestFilename);
            retiredAtDeletion.push(api.asset(asset.id));
        }
        return api.execute(args, input);
    }, {now: now + RETIREMENT_GRACE_PERIOD_MS});
    assert.ok(retiredAtDeletion.length > 0);
    for (const retired of retiredAtDeletion) assert.deepEqual(retired, {...fixture.assets[101], expired: true, expiredAt: new Date(now).toISOString()});
    for (const platform of platforms) for (const runner of ['cypress', 'playwright']) {
        assert.deepEqual(await resolve(directory, {MAGELENS_IMAGE_PLATFORM: platform, MAGELENS_RUNNER: runner}, request), {php: null, [`runner-${runner}`]: null});
    }
    const removed = deleteRequests(api.calls).map(args => args.at(-1));
    assert.ok(removed.includes(`${packagesEndpoint}/php/versions/10`));
    assert.ok(!removed.includes(`${packagesEndpoint}/php/versions/11`), 'Shared protected digest must survive');
    assert.equal(removed.length, 8);
    const backup = api.release('v2.0.1').assets.find(a => a.name === 'images-retired-101.json');
    assert.deepEqual(api.asset(backup.id), fixture.assets[101]);
    assert.ok(!api.calls.some(args => args.some(arg => arg.includes('/git/refs'))), 'Historical tags must never change');
    const uploadsBefore = api.calls.filter(args => args.includes('POST')).length;
    prune(api.execute, {now: now + RETIREMENT_GRACE_PERIOD_MS});
    assert.equal(api.calls.filter(args => args.includes('POST')).length, uploadsBefore, 'Already expired manifests need no replacement');
});

for (const failure of ['uploadFailure', 'renameFailure', 'readbackFailure']) {
    test(`expiration ${failure} fails distinctly and makes zero DELETE requests`, () => {
        const api = mockApi({...retentionFixture(), [failure]: true});
        assert.throws(() => prune(api.execute, {now}), expirationApiErrorPattern);
        assert.deepEqual(deleteRequests(api.calls), []);
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
    const boundary = now - 14 * dayMs;
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
    assertDeletions(api.calls, [999]);
    assert.ok(!api.calls.some(args => args.includes('POST')));
});

test('90-day retention boundary preserves an otherwise eligible release until the boundary passes', () => {
    const fixture = retentionFixture();
    fixture.releases[0].published_at = new Date(now - 90 * dayMs).toISOString();
    // Keep five newer releases, so age is the only protection for the oldest.
    for (let i = 1; i < fixture.releases.length; i++) fixture.releases[i].published_at = new Date(now - (90 - i) * dayMs).toISOString();
    const api = mockApi(fixture);
    prune(api.execute, {now});
    assert.ok(!api.calls.some(args => args.includes('POST')));
    const expired = mockApi(fixture);
    prune(expired.execute, {now: now + 1});
    assert.equal(expired.calls.filter(args => args.includes('POST')).length, 1);
});

for (const protocol of [null, 2]) {
    test(`unsupported expiration contract (${protocol}) preserves historical images without rewriting the manifest`, () => {
        const api = mockApi(retentionFixture({protocol}));
        prune(api.execute, {now});
        assertDeletions(api.calls, [999]);
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
        }, {now}), expirationVerificationErrorPattern);
        assert.deepEqual(deleteRequests(api.calls), []);
    });
}

test('all exact legacy exceptions retain available digests and never apply to the latest release', () => {
    const exceptions = require('./release/legacy-missing-images.json');
    for (const [version, entries] of Object.entries(exceptions)) {
        const images = Object.fromEntries(kinds.map(kind => [kind, {inputs: published.images[kind].inputs, digest: entries['linux/amd64'][kind]}]));
        const historical = {schema: 1, version, platform: 'linux/amd64', images};
        const options = {historicalReleases: [{tag_name: `v${version}`, assets: [{id: 124, name: manifestFilename}]}], assets: {124: historical}};
        const absent = mockApi(options);
        prune(absent.execute, {now});
        assertDeletions(absent.calls, [2, 3]);
        const present = mockApi({...options, packageVersions: endpoint => {
            const kind = packageKind(endpoint);
            return [[oldImage(1, digest('a')), oldImage(2, images[kind].digest), oldImage(3, digest('0'))]];
        }});
        prune(present.execute, {now});
        assertDeletions(present.calls, [3]);
        const latest = mockApi({...options, latestTag: `v${version}`});
        assert.throws(() => prune(latest.execute, {now}), /Published image missing/);
        assert.deepEqual(mutations(latest.calls), []);
    }
});

test('retirement stays valid after installer revisions and missing images remain mandatory for actual pins', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-retirement-revision-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const files = ['bin/image-inputs.cjs', 'bin/prepare-images', 'tests/release/prune-images.cjs', 'tests/release/legacy-missing-images.json'];
    for (const file of files) {
        const target = path.join(directory, file);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.copyFileSync(path.join(root, file), target);
    }
    const cleanupPath = path.join(directory, 'tests/release/prune-images.cjs');
    const api = mockApi(retentionFixture());
    const first = require(cleanupPath).prune;
    first(api.execute, {now});
    first(api.execute, {now: now + RETIREMENT_GRACE_PERIOD_MS});
    assert.ok(!api.versions('php').some(image => image.id === 10), 'The retired digest was actually removed');
    fs.appendFileSync(path.join(directory, 'bin/prepare-images'), '\n# A later installer revision.\n');
    fs.appendFileSync(path.join(directory, 'bin/image-inputs.cjs'), '\n// The expiration contract is unchanged.\n');
    delete require.cache[cleanupPath];
    delete require.cache[path.join(directory, 'bin/image-inputs.cjs')];
    api.calls.length = 0;
    require(cleanupPath).prune(api.execute, {now: now + RETIREMENT_GRACE_PERIOD_MS + 1});
    assert.deepEqual(mutations(api.calls), []);
    assert.throws(() => require(cleanupPath).prune(api.execute, {
        now: now + RETIREMENT_GRACE_PERIOD_MS + 1, pinned: ['v2.0.1']
    }), /Published image missing/);
    assert.deepEqual(mutations(api.calls), []);
});

test('an interrupted second rename resumes the original retirement and observes the exact retirement grace boundary', () => {
    const api = mockApi({...retentionFixture(), failSecondRenameOnce: true});
    assert.throws(() => prune(api.execute, {now}), /HTTP 503/);
    assertDeletions(api.calls, []);
    assert.deepEqual(api.release('v2.0.1').assets.map(asset => asset.name).sort(), ['images-expired.json', 'images-retired-101.json']);
    assert.ok(api.versions('php').some(image => image.id === 10));
    prune(api.execute, {now: now + 1});
    assertDeletions(api.calls, [999]);
    const canonical = api.release('v2.0.1').assets.find(asset => asset.name === manifestFilename);
    assert.equal(api.asset(canonical.id).expiredAt, new Date(now).toISOString(), 'Recovery must preserve the original retirement time');
    prune(api.execute, {now: now + RETIREMENT_GRACE_PERIOD_MS - 1});
    assertDeletions(api.calls, [999]);
    prune(api.execute, {now: now + RETIREMENT_GRACE_PERIOD_MS});
    assertDeletions(api.calls, [10, 11, 999]);
    assert.equal(api.calls.filter(args => args.includes('POST')).length, 1);
    assert.equal(api.calls.filter(args => args.includes('PATCH') && args.at(-1).endsWith('/assets/101')).length, 1);
});

const interruptedFailures = {
    'missing backup': fixture => {fixture.releases[0].assets.shift();},
    'missing stage': fixture => {fixture.releases[0].assets.pop();},
    'wrong backup name': fixture => {fixture.releases[0].assets[0].name = 'images-retired-999.json';},
    'wrong version': fixture => {fixture.assets[10001].version = '2.0.99';},
    'unexpired stage': fixture => {fixture.assets[10001].expired = false;},
    'different provenance': fixture => {fixture.assets[10001].platforms['linux/arm64'].php.inputs = '0'.repeat(64);},
    'invalid timestamp': fixture => {fixture.assets[10001].expiredAt = 'invalid';},
    'future timestamp': fixture => {fixture.assets[10001].expiredAt = new Date(now + 1).toISOString();},
    'missing timestamp': fixture => {delete fixture.assets[10001].expiredAt;}
};
for (const [failure, applyFailure] of Object.entries(interruptedFailures)) {
    test(`unexplained or invalid interrupted retirement (${failure}) fails before any mutation`, () => {
        const fixture = retentionFixture();
        fixture.releases[0].assets = [{id: 101, name: 'images-retired-101.json'}, {id: 10001, name: 'images-expired.json'}];
        fixture.assets[10001] = {...structuredClone(fixture.assets[101]), expired: true, expiredAt: new Date(now).toISOString()};
        applyFailure(fixture);
        const api = mockApi(fixture);
        assert.throws(() => prune(api.execute, {now}));
        assert.deepEqual(mutations(api.calls), []);
    });
}

test('interrupted retirement still validates every protected digest before repairing assets', () => {
    const fixture = retentionFixture();
    const api = mockApi({...fixture, failSecondRenameOnce: true});
    assert.throws(() => prune(api.execute, {now}), /HTTP 503/);
    api.execute(['--method', 'DELETE', `${packagesEndpoint}/runner-playwright/versions/51`]);
    api.calls.length = 0;
    assert.throws(() => prune(api.execute, {now: now + 1}), /Published image missing/);
    assert.deepEqual(mutations(api.calls), []);
});

test('previously retired manifests without the new contract do not reactivate after their images were removed', () => {
    const fixture = retentionFixture({protocol: null});
    fixture.assets[101].expired = true;
    for (const kind of kinds) fixture.inventories[kind] = fixture.inventories[kind].filter(image => ![10, 11].includes(image.id));
    const api = mockApi(fixture);
    prune(api.execute, {now});
    assertDeletions(api.calls, [999]);
    assert.ok(!api.calls.some(args => args.includes('POST') || args.includes('PATCH')));
});
