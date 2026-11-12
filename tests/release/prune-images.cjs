// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {
    kinds, digestPattern, releaseTagPattern, validateManifest, platformImages,
    repository, manifestFilename, normalizeLineEndings
} = require('../../bin/image-inputs.cjs');
const executeApi = (args, input) => execFileSync('gh', ['api', ...args], {encoding: 'utf8', input});
const repositoryEndpoint = `repos/${repository}`;
const releasesEndpoint = `${repositoryEndpoint}/releases`;
const packagesEndpoint = `orgs/${repository.split('/')[0]}/packages/container`;
const githubUploadsUrl = 'https://uploads.github.com';
const assetAcceptHeader = 'Accept: application/octet-stream';
const sourceAcceptHeader = 'Accept: application/vnd.github.raw+json';
const jsonContentTypeHeader = 'Content-Type: application/json';
const expirationAssetName = 'images-expired.json';
const retiredAssetName = id => `images-retired-${id}.json`;
const expirationInstallerFiles = ['bin/image-inputs.cjs', 'bin/prepare-images'];
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const pinnedReleaseSeparator = /[\s,]+/;
const versionFromTag = tag => tag.startsWith('v') ? tag.slice(1) : tag;

const FIRST_PREBUILT_VERSION = '1.9.0';
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_WINDOW_MS = 90 * DAY_MS;
const MINIMUM_RELEASES_RETAINED = 5;
const GRACE_PERIOD_MS = 14 * DAY_MS;
// These exact AMD64 images were purged by the latest-only policy before PR #45.
// Confirmed absent from public GHCR on 2026-11-12. This is not a version exemption:
// changed digests and every other release/platform still require inventory checks.
const legacyMissingImages = require('./legacy-missing-images.json');

function githubApi(execute) {
    const json = (args, input) => JSON.parse(execute(args, input));
    const assetEndpoint = id => `${releasesEndpoint}/assets/${id}`;
    return {
        get: endpoint => json([endpoint]),
        list: endpoint => json(['--paginate', '--slurp', `${endpoint}?per_page=100`]).flat(),
        downloadAsset: id => json(['-H', assetAcceptHeader, assetEndpoint(id)]),
        source: (file, tag) => execute([
            '-H', sourceAcceptHeader, `${repositoryEndpoint}/contents/${file}?ref=${tag}`
        ]),
        uploadAsset: (releaseId, name, data) => json([
            '--method', 'POST', '-H', jsonContentTypeHeader, '--input', '-',
            `${githubUploadsUrl}/${releasesEndpoint}/${releaseId}/assets?name=${name}`
        ], JSON.stringify(data)),
        renameAsset: (id, name) => json(['--method', 'PATCH', '-f', `name=${name}`, assetEndpoint(id)])
    };
}

function cleanupClock(now = Date.now()) {
    const timestamp = new Date(now).getTime();
    assert.ok(Number.isFinite(timestamp), 'Invalid cleanup clock');
    return timestamp;
}

function imageCreationTime(version) {
    // GitHub timestamps use UTC, optionally with milliseconds. Round-tripping
    // rejects calendar dates that Date.parse would silently normalize.
    const timestamp = version.created_at;
    const created = typeof timestamp === 'string' && utcTimestampPattern.test(timestamp) ? Date.parse(timestamp) : NaN;
    const validTimestamp = Number.isFinite(created)
        && new Date(created).toISOString().replace('.000Z', 'Z') === timestamp.replace('.000Z', 'Z');
    assert.ok(validTimestamp, `Unknown image creation time for ${version.name}; refusing cleanup`);
    return created;
}

function obsoleteVersions(versions, requiredDigests, protectedDigests = requiredDigests, options = {}) {
    const required = Array.isArray(requiredDigests) ? requiredDigests : requiredDigests ? [requiredDigests] : [];
    const protectedSet = new Set(Array.isArray(protectedDigests) ? protectedDigests : protectedDigests ? [protectedDigests] : required);
    const now = cleanupClock(options.now);
    for (const digest of required) assert.ok(versions.some(version => version.name === digest), 'Published image missing; refusing cleanup');
    for (const version of versions) {
        assert.ok(Number.isSafeInteger(version.id) && version.id > 0, 'Invalid package version');
        assert.match(version.name, digestPattern);
    }
    return versions.filter(version => {
        if (protectedSet.has(version.name)) return false;
        return now - imageCreationTime(version) >= GRACE_PERIOD_MS;
    }).map(version => version.id);
}

const semverCompare = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
};

function supportsExpiration(api, release) {
    // Compare the tagged resolver and source-build consumer with the trusted,
    // regression-tested implementation. Never execute downloaded installer code
    // or infer support from a version number. Unrecognized implementations retain
    // their images; lookup/authentication failures abort the whole plan.
    return expirationInstallerFiles.map(file => {
        const tagged = api.source(file, release.tag_name);
        const trusted = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
        return normalizeLineEndings(tagged) === normalizeLineEndings(trusted);
    }).every(Boolean);
}

function retireManifest(api, {release, asset, manifest}) {
    const expired = {...manifest, expired: true};
    // Upload first and keep the original asset for audit/recovery. Renaming assets
    // avoids deleting the active manifest before its replacement is available.
    // A supported installer also builds from source during the brief 404 gap.
    const staged = release.assets.find(a => a.name === expirationAssetName)
        || api.uploadAsset(release.id, expirationAssetName, expired);
    assert.ok(Number.isSafeInteger(staged.id) && staged.id > 0 && staged.id !== asset.id, 'Invalid staged expiration asset');
    assert.deepEqual(api.downloadAsset(staged.id), expired, 'Expiration upload verification failed');
    for (const [id, name] of [[asset.id, retiredAssetName(asset.id)], [staged.id, manifestFilename]]) {
        const renamed = api.renameAsset(id, name);
        assert.equal(renamed.id, id, 'Expiration asset ID changed');
        assert.equal(renamed.name, name, 'Expiration asset rename failed');
    }
    const updated = api.get(`${releasesEndpoint}/tags/${release.tag_name}`);
    const canonicalAsset = updated.assets?.find(a => a.name === manifestFilename);
    assert.equal(canonicalAsset?.id, staged.id, 'Expired manifest is not the canonical release asset');
    assert.deepEqual(api.downloadAsset(staged.id), expired, 'Expired manifest readback failed');
}

function releaseDigests(manifests, kind, latestVersion) {
    const requiredDigests = new Set();
    const protectedDigests = new Set();
    for (const manifest of manifests) for (const [platform, images] of Object.entries(platformImages(manifest))) {
        const digest = images[kind].digest;
        const previouslyPurged = legacyMissingImages[manifest.version]?.[platform]?.[kind] === digest;
        protectedDigests.add(digest);
        if (manifest.version === latestVersion || !previouslyPurged) requiredDigests.add(digest);
    }
    return {requiredDigests: [...requiredDigests], protectedDigests: [...protectedDigests]};
}

function prune(execute = executeApi, options = {}) {
    const api = githubApi(execute);
    const now = cleanupClock(options.now);
    const pinned = options.pinned || (process.env.PINNED_RELEASES || '').split(pinnedReleaseSeparator).filter(Boolean);
    const pinnedSet = new Set(pinned.map(versionFromTag));

    const releases = api.list(releasesEndpoint);
    const publishedReleases = releases.filter(r => !r.draft && (r.published_at || r.tag_name));
    for (const release of publishedReleases) {
        assert.match(release.tag_name, releaseTagPattern, 'Invalid release tag');
        if (release.published_at) assert.ok(Number.isFinite(Date.parse(release.published_at)), 'Invalid release publication time');
    }
    publishedReleases.sort((a, b) => {
        const timeA = a.published_at ? new Date(a.published_at).getTime() : 0;
        const timeB = b.published_at ? new Date(b.published_at).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;
        return semverCompare(versionFromTag(b.tag_name), versionFromTag(a.tag_name));
    });

    const latestTag = publishedReleases.length ? api.get(`${releasesEndpoint}/latest`).tag_name : null;
    assert.ok(!publishedReleases.length || publishedReleases.some(release => release.tag_name === latestTag), 'Latest release missing from release inventory');
    const protectedReleases = new Set();
    publishedReleases.forEach((release, index) => {
        const version = versionFromTag(release.tag_name);
        const ageMs = release.published_at ? now - new Date(release.published_at).getTime() : 0;
        const isLatest = release.tag_name === latestTag;
        const isRecent = ageMs <= RETENTION_WINDOW_MS;
        const isWithinTopFive = index < MINIMUM_RELEASES_RETAINED;
        const isPinned = pinnedSet.has(version) || pinnedSet.has(release.tag_name);

        if (isLatest || isRecent || isWithinTopFive || isPinned) {
            protectedReleases.add(release);
        }
    });

    const protectedManifests = [];
    const expirations = [];
    for (const release of publishedReleases) {
        const version = versionFromTag(release.tag_name);
        const predatesPrebuilt = semverCompare(version, FIRST_PREBUILT_VERSION) < 0;
        const isProtected = protectedReleases.has(release);

        if (predatesPrebuilt) {
            continue;
        }

        const asset = release.assets?.find(a => a.name === manifestFilename);
        if (!asset) {
            throw new Error(`${isProtected ? 'Protected release' : 'Release'} ${release.tag_name} is missing images.json manifest; refusing cleanup`);
        }
        assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0, 'Invalid manifest asset ID');
        const manifest = validateManifest(api.downloadAsset(asset.id));
        assert.equal(release.tag_name, `v${manifest.version}`, `Release manifest ${release.tag_name} has version mismatch`);
        if (isProtected || !supportsExpiration(api, release)) {
            // Even a pinned, previously expired manifest must supply its complete
            // inventory. An expired flag cannot exempt a protected release.
            protectedManifests.push(validateManifest({...manifest, expired: false}));
        } else if (manifest.expired !== true) {
            assert.ok(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid release ID for expiration');
            assert.ok(!release.assets.some(a => a.name === retiredAssetName(asset.id)), 'Retired manifest asset already exists');
            expirations.push({release, asset, manifest});
        }
    }

    const latestRelease = publishedReleases.find(release => release.tag_name === latestTag);
    const latestVersion = latestRelease ? versionFromTag(latestRelease.tag_name) : null;
    const deletions = [];
    for (const kind of kinds) {
        const endpoint = `${packagesEndpoint}/${kind}`;
        let info;
        try { info = api.get(endpoint); }
        catch (error) {
            if (!protectedManifests.length && String(error.stderr).includes('HTTP 404')) continue;
            throw error;
        }
        assert.equal(info.repository?.full_name, repository, 'Refusing to prune a package owned by another repository');
        const versions = api.list(`${endpoint}/versions`);

        const {requiredDigests, protectedDigests} = releaseDigests(protectedManifests, kind, latestVersion);
        if (!protectedManifests.length) {
            const newest = versions.reduce((candidate, version) => !candidate || version.id > candidate.id ? version : candidate, null);
            if (newest) {
                requiredDigests.push(newest.name);
                protectedDigests.push(newest.name);
            }
        }

        for (const id of obsoleteVersions(versions, requiredDigests, protectedDigests, {now})) {
            deletions.push(`${endpoint}/versions/${id}`);
        }
    }
    // No mutation until every manifest, required digest and candidate age in all
    // three packages has passed validation. All retirements must succeed before
    // the first image deletion; failures leave image inventories untouched.
    for (const expiration of expirations) retireManifest(api, expiration);
    for (const endpoint of deletions) execute(['--method', 'DELETE', endpoint]);
    console.log(`Removed ${deletions.length} obsolete image versions; retained ${protectedManifests.length ? `${protectedManifests.length} published release(s)` : 'one initial candidate per package for visibility setup'}.`);
}

module.exports = {
    obsoleteVersions,
    prune,
    FIRST_PREBUILT_VERSION,
    RETENTION_WINDOW_MS,
    MINIMUM_RELEASES_RETAINED,
    GRACE_PERIOD_MS
};

if (require.main === module) {
    assert.equal(process.env.GITHUB_REPOSITORY, repository);
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    prune();
}
