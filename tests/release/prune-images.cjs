// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {kinds, validateManifest, platformImages} = require('../../bin/image-inputs.cjs');
const api = (args, input) => execFileSync('gh', ['api', ...args], {encoding: 'utf8', input});

const FIRST_PREBUILT_VERSION = '1.9.0';
const RETENTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const MINIMUM_RELEASES_RETAINED = 5;
const GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;
// These exact AMD64 images were purged by the latest-only policy before PR #45.
// Confirmed absent from public GHCR on 2026-11-12. This is not a version exemption:
// changed digests and every other release/platform still require inventory checks.
const legacyMissingImages = require('./legacy-missing-images.json');

function obsoleteVersions(versions, requiredDigests, protectedDigests = requiredDigests, options = {}) {
    const required = Array.isArray(requiredDigests) ? requiredDigests : requiredDigests ? [requiredDigests] : [];
    const protectedSet = new Set(Array.isArray(protectedDigests) ? protectedDigests : protectedDigests ? [protectedDigests] : required);
    const now = options.now !== undefined ? new Date(options.now).getTime() : Date.now();
    assert.ok(Number.isFinite(now), 'Invalid cleanup clock');
    for (const digest of required) assert.ok(versions.some(version => version.name === digest), 'Published image missing; refusing cleanup');
    for (const version of versions) {
        assert.ok(Number.isSafeInteger(version.id) && version.id > 0, 'Invalid package version');
        assert.match(version.name, /^sha256:[a-f0-9]{64}$/);
    }
    return versions.filter(version => {
        if (protectedSet.has(version.name)) return false;
        const timestamp = version.created_at;
        const created = typeof timestamp === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(timestamp) ? Date.parse(timestamp) : NaN;
        const validTimestamp = Number.isFinite(created)
            && new Date(created).toISOString().replace('.000Z', 'Z') === timestamp.replace('.000Z', 'Z');
        assert.ok(validTimestamp, `Unknown image creation time for ${version.name}; refusing cleanup`);
        return now - created >= GRACE_PERIOD_MS;
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

function supportsExpiration(execute, release) {
    // Compare the tagged resolver and source-build consumer with the trusted,
    // regression-tested implementation. Never execute downloaded installer code
    // or infer support from a version number. Unrecognized implementations retain
    // their images; lookup/authentication failures abort the whole plan.
    return ['bin/image-inputs.cjs', 'bin/prepare-images'].map(file => {
        const tagged = execute(['-H', 'Accept: application/vnd.github.raw+json',
            `repos/MageLens/MageLens/contents/${file}?ref=${release.tag_name}`]);
        return tagged.replace(/\r\n/g, '\n') === fs.readFileSync(path.join(__dirname, '../..', file), 'utf8').replace(/\r\n/g, '\n');
    }).every(Boolean);
}

function retireManifest(execute, {release, asset, manifest}) {
    const expired = {...manifest, expired: true};
    // Upload first and keep the original asset for audit/recovery. Renaming assets
    // avoids deleting the active manifest before its replacement is available.
    // A supported installer also builds from source during the brief 404 gap.
    let staged = release.assets.find(a => a.name === 'images-expired.json');
    if (!staged) staged = JSON.parse(execute(['--method', 'POST', '-H', 'Content-Type: application/json', '--input', '-',
        `https://uploads.github.com/repos/MageLens/MageLens/releases/${release.id}/assets?name=images-expired.json`], JSON.stringify(expired)));
    assert.ok(Number.isSafeInteger(staged.id) && staged.id > 0 && staged.id !== asset.id, 'Invalid staged expiration asset');
    assert.deepEqual(JSON.parse(execute(['-H', 'Accept: application/octet-stream', `repos/MageLens/MageLens/releases/assets/${staged.id}`])), expired, 'Expiration upload verification failed');
    for (const [id, name] of [[asset.id, `images-retired-${asset.id}.json`], [staged.id, 'images.json']]) {
        const renamed = JSON.parse(execute(['--method', 'PATCH', '-f', `name=${name}`, `repos/MageLens/MageLens/releases/assets/${id}`]));
        assert.equal(renamed.id, id, 'Expiration asset ID changed');
        assert.equal(renamed.name, name, 'Expiration asset rename failed');
    }
    const updated = JSON.parse(execute([`repos/MageLens/MageLens/releases/tags/${release.tag_name}`]));
    assert.equal(updated.assets?.find(a => a.name === 'images.json')?.id, staged.id, 'Expired manifest is not the canonical release asset');
    assert.deepEqual(JSON.parse(execute(['-H', 'Accept: application/octet-stream', `repos/MageLens/MageLens/releases/assets/${staged.id}`])), expired, 'Expired manifest readback failed');
}

function prune(execute = api, options = {}) {
    const now = options.now !== undefined ? new Date(options.now).getTime() : Date.now();
    assert.ok(Number.isFinite(now), 'Invalid cleanup clock');
    const pinned = options.pinned || (process.env.PINNED_RELEASES ? process.env.PINNED_RELEASES.split(/[\s,]+/).filter(Boolean) : []);
    const pinnedSet = new Set(pinned.map(p => p.replace(/^v/, '')));

    const releases = JSON.parse(execute(['--paginate', '--slurp', 'repos/MageLens/MageLens/releases?per_page=100'])).flat();
    const publishedReleases = releases.filter(r => !r.draft && (r.published_at || r.tag_name));
    for (const release of publishedReleases) {
        assert.match(release.tag_name, /^v\d+\.\d+\.\d+$/, 'Invalid release tag');
        if (release.published_at) assert.ok(Number.isFinite(Date.parse(release.published_at)), 'Invalid release publication time');
    }
    publishedReleases.sort((a, b) => {
        const timeA = a.published_at ? new Date(a.published_at).getTime() : 0;
        const timeB = b.published_at ? new Date(b.published_at).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;
        return semverCompare(b.tag_name.replace(/^v/, ''), a.tag_name.replace(/^v/, ''));
    });

    const latestTag = publishedReleases.length ? JSON.parse(execute(['repos/MageLens/MageLens/releases/latest'])).tag_name : null;
    assert.ok(!publishedReleases.length || publishedReleases.some(release => release.tag_name === latestTag), 'Latest release missing from release inventory');
    const protectedReleases = new Set();
    publishedReleases.forEach((release, index) => {
        const version = release.tag_name.replace(/^v/, '');
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
        const version = release.tag_name.replace(/^v/, '');
        const predatesPrebuilt = semverCompare(version, FIRST_PREBUILT_VERSION) < 0;
        const isProtected = protectedReleases.has(release);

        if (predatesPrebuilt) {
            continue;
        }

        const asset = release.assets?.find(a => a.name === 'images.json');
        if (!asset) {
            throw new Error(`${isProtected ? 'Protected release' : 'Release'} ${release.tag_name} is missing images.json manifest; refusing cleanup`);
        }
        assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0, 'Invalid manifest asset ID');
        const parsed = JSON.parse(execute(['-H', 'Accept: application/octet-stream', `repos/MageLens/MageLens/releases/assets/${asset.id}`]));
        const manifest = validateManifest(parsed);
        assert.equal(release.tag_name, `v${manifest.version}`, `Release manifest ${release.tag_name} has version mismatch`);
        if (isProtected || !supportsExpiration(execute, release)) {
            // Even a pinned, previously expired manifest must supply its complete
            // inventory. An expired flag cannot exempt a protected release.
            protectedManifests.push(validateManifest({...manifest, expired: false}));
        } else if (manifest.expired !== true) {
            assert.ok(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid release ID for expiration');
            assert.ok(!release.assets.some(a => a.name === `images-retired-${asset.id}.json`), 'Retired manifest asset already exists');
            expirations.push({release, asset, manifest});
        }
    }

    const latestRelease = publishedReleases.find(release => release.tag_name === latestTag);
    const latestVersion = latestRelease ? latestRelease.tag_name.replace(/^v/, '') : null;
    const deletions = [];
    for (const kind of kinds) {
        const endpoint = `orgs/MageLens/packages/container/${kind}`;
        let info;
        try { info = JSON.parse(execute([endpoint])); }
        catch (error) {
            if (!protectedManifests.length && String(error.stderr).includes('HTTP 404')) continue;
            throw error;
        }
        assert.equal(info.repository?.full_name, 'MageLens/MageLens', 'Refusing to prune a package owned by another repository');
        const versions = JSON.parse(execute(['--paginate', '--slurp', `${endpoint}/versions?per_page=100`])).flat();

        const requiredDigests = protectedManifests.flatMap(manifest => Object.entries(platformImages(manifest)).flatMap(([platform, images]) => {
            const digest = images[kind].digest;
            if (manifest.version !== latestVersion && legacyMissingImages[manifest.version]?.[platform]?.[kind] === digest) return [];
            return [digest];
        }));
        const protectedDigests = protectedManifests.length
            ? [...new Set(protectedManifests.flatMap(manifest => Object.values(platformImages(manifest)).map(images => images[kind]?.digest).filter(Boolean)))]
            : versions.reduce((newest, version) => !newest || version.id > newest.id ? version : newest, null)?.name;

        for (const id of obsoleteVersions(versions, protectedManifests.length ? requiredDigests : protectedDigests, protectedDigests, {now})) {
            deletions.push(`${endpoint}/versions/${id}`);
        }
    }
    // No mutation until every manifest, required digest and candidate age in all
    // three packages has passed validation. All retirements must succeed before
    // the first image deletion; failures leave image inventories untouched.
    for (const expiration of expirations) retireManifest(execute, expiration);
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
    assert.equal(process.env.GITHUB_REPOSITORY, 'MageLens/MageLens');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    prune();
}
