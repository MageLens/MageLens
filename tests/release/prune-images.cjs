// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {kinds, validateManifest, platformImages} = require('../../bin/image-inputs.cjs');
const api = args => execFileSync('gh', ['api', ...args], {encoding: 'utf8'});

const FIRST_PREBUILT_VERSION = '1.9.0';
const RETENTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const MINIMUM_RELEASES_RETAINED = 5;
const GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

function obsoleteVersions(versions, requiredDigests, protectedDigests = requiredDigests, options = {}) {
    const required = Array.isArray(requiredDigests) ? requiredDigests : requiredDigests ? [requiredDigests] : [];
    const protectedSet = new Set(Array.isArray(protectedDigests) ? protectedDigests : protectedDigests ? [protectedDigests] : required);
    const now = options.now !== undefined ? new Date(options.now).getTime() : Date.now();
    for (const digest of required) assert.ok(versions.some(version => version.name === digest), 'Published image missing; refusing cleanup');
    for (const version of versions) {
        assert.ok(Number.isSafeInteger(version.id) && version.id > 0, 'Invalid package version');
        assert.match(version.name, /^sha256:[a-f0-9]{64}$/);
    }
    return versions.filter(version => {
        if (protectedSet.has(version.name)) return false;
        if (version.created_at) {
            const ageMs = now - new Date(version.created_at).getTime();
            if (ageMs < GRACE_PERIOD_MS) return false;
        }
        return true;
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

function prune(execute = api, options = {}) {
    const now = options.now !== undefined ? new Date(options.now).getTime() : Date.now();
    const pinned = options.pinned || (process.env.PINNED_RELEASES ? process.env.PINNED_RELEASES.split(/[\s,]+/).filter(Boolean) : []);
    const pinnedSet = new Set(pinned.map(p => p.replace(/^v/, '')));

    const releases = JSON.parse(execute(['--paginate', '--slurp', 'repos/MageLens/MageLens/releases?per_page=100'])).flat();
    const publishedReleases = releases.filter(r => !r.draft && (r.published_at || r.tag_name));
    publishedReleases.sort((a, b) => {
        const timeA = a.published_at ? new Date(a.published_at).getTime() : 0;
        const timeB = b.published_at ? new Date(b.published_at).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;
        return semverCompare(b.tag_name.replace(/^v/, ''), a.tag_name.replace(/^v/, ''));
    });

    const protectedReleases = new Set();
    publishedReleases.forEach((release, index) => {
        const version = release.tag_name.replace(/^v/, '');
        const ageMs = release.published_at ? now - new Date(release.published_at).getTime() : 0;
        const isLatest = index === 0;
        const isRecent = ageMs <= RETENTION_WINDOW_MS;
        const isWithinTopFive = index < MINIMUM_RELEASES_RETAINED;
        const isPinned = pinnedSet.has(version) || pinnedSet.has(release.tag_name);

        if (isLatest || isRecent || isWithinTopFive || isPinned) {
            protectedReleases.add(release);
        }
    });

    const protectedManifests = [];
    for (const release of publishedReleases) {
        const version = release.tag_name.replace(/^v/, '');
        const predatesPrebuilt = semverCompare(version, FIRST_PREBUILT_VERSION) < 0;
        const isProtected = protectedReleases.has(release);

        if (predatesPrebuilt) {
            continue;
        }

        const asset = release.assets?.find(a => a.name === 'images.json');
        if (isProtected) {
            if (!asset) {
                throw new Error(`Protected release ${release.tag_name} is missing images.json manifest; refusing cleanup`);
            }
            assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0);
            const parsed = JSON.parse(execute(['-H', 'Accept: application/octet-stream', `repos/MageLens/MageLens/releases/assets/${asset.id}`]));
            const manifest = validateManifest(parsed);
            assert.equal(release.tag_name, `v${manifest.version}`, `Release manifest ${release.tag_name} has version mismatch`);
            protectedManifests.push(manifest);
        } else if (asset) {
            try {
                const parsed = JSON.parse(execute(['-H', 'Accept: application/octet-stream', `repos/MageLens/MageLens/releases/assets/${asset.id}`]));
                const manifest = validateManifest(parsed);
                if (!manifest.expired) {
                    protectedManifests.push(manifest);
                }
            } catch {
                // If fetching an expired manifest fails, don't block cleanup unless needed
            }
        }
    }

    const latestRelease = publishedReleases[0];
    const latestVersion = latestRelease ? latestRelease.tag_name.replace(/^v/, '') : null;
    const latestManifest = protectedManifests.find(m => m.version === latestVersion);
    const deletions = [];
    for (const kind of kinds) {
        const endpoint = `orgs/MageLens/packages/container/${kind}`;
        let info;
        try { info = JSON.parse(execute([endpoint])); }
        catch (error) {
            if (!latestManifest && String(error.stderr).includes('HTTP 404')) continue;
            throw error;
        }
        assert.equal(info.repository?.full_name, 'MageLens/MageLens', 'Refusing to prune a package owned by another repository');
        const versions = JSON.parse(execute(['--paginate', '--slurp', `${endpoint}/versions?per_page=100`])).flat();

        const latestDigests = latestManifest ? Object.values(platformImages(latestManifest)).map(images => images[kind]?.digest).filter(Boolean) : [];
        const protectedDigests = protectedManifests.length
            ? [...new Set(protectedManifests.flatMap(manifest => Object.values(platformImages(manifest)).map(images => images[kind]?.digest).filter(Boolean)))]
            : versions.reduce((newest, version) => !newest || version.id > newest.id ? version : newest, null)?.name;

        for (const id of obsoleteVersions(versions, latestDigests.length ? latestDigests : protectedDigests, protectedDigests, {now})) {
            deletions.push(`${endpoint}/versions/${id}`);
        }
    }
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
