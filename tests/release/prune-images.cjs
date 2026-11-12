// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {kinds, validateManifest, platformImages} = require('../../bin/image-inputs.cjs');
const api = args => execFileSync('gh', ['api', ...args], {encoding: 'utf8'});
function obsoleteVersions(versions, keepDigest, protectedDigests = keepDigest) {
    const keep = Array.isArray(keepDigest) ? keepDigest : keepDigest ? [keepDigest] : [];
    const protectedSet = new Set(Array.isArray(protectedDigests) ? protectedDigests : protectedDigests ? [protectedDigests] : keep);
    for (const digest of keep) assert.ok(versions.some(version => version.name === digest), 'Published image missing; refusing cleanup');
    for (const version of versions) {
        assert.ok(Number.isSafeInteger(version.id) && version.id > 0, 'Invalid package version');
        assert.match(version.name, /^sha256:[a-f0-9]{64}$/);
    }
    return versions.filter(version => !protectedSet.has(version.name)).map(version => version.id);
}
const semverCompare = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
    }
    return 0;
};
function prune(execute = api) {
    // Read published releases with manifests to protect historical and latest images.
    // A network/authentication error must never be interpreted as an empty keep list.
    const releases = JSON.parse(execute(['--paginate', '--slurp', 'repos/MageLens/MageLens/releases?per_page=100'])).flat();
    const manifests = [];
    for (const release of releases) {
        if (release.draft) continue;
        const asset = release.assets?.find(asset => asset.name === 'images.json');
        if (!asset) continue;
        assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0);
        const manifest = validateManifest(JSON.parse(execute(['-H', 'Accept: application/octet-stream', `repos/MageLens/MageLens/releases/assets/${asset.id}`])));
        assert.equal(release.tag_name, `v${manifest.version}`, 'Release manifest has the wrong version');
        manifests.push(manifest);
    }
    manifests.sort((a, b) => semverCompare(a.version, b.version));
    const latestManifest = manifests[0];
    const deletions = [];
    for (const kind of kinds) {
        const endpoint = `orgs/MageLens/packages/container/${kind}`;
        let info;
        try { info = JSON.parse(execute([endpoint])); }
        catch (error) {
            // A failed first build may not have created all three packages yet.
            if (!latestManifest && String(error.stderr).includes('HTTP 404')) continue;
            throw error;
        }
        assert.equal(info.repository?.full_name, 'MageLens/MageLens', 'Refusing to prune a package owned by another repository');
        const versions = JSON.parse(execute(['--paginate', '--slurp', `${endpoint}/versions?per_page=100`])).flat();
        // GHCR refuses deletion of the last tagged version. Before the first
        // image release, retain one candidate per package for visibility setup.
        const latestDigests = latestManifest ? Object.values(platformImages(latestManifest)).map(images => images[kind].digest) : [];
        const protectedDigests = latestManifest
            ? [...new Set(manifests.flatMap(manifest => Object.values(platformImages(manifest)).map(images => images[kind].digest)))]
            : versions.reduce((newest, version) => !newest || version.id > newest.id ? version : newest, null)?.name;
        for (const id of obsoleteVersions(versions, latestDigests.length ? latestDigests : protectedDigests, protectedDigests)) {
            deletions.push(`${endpoint}/versions/${id}`);
        }
    }
    // Validate all keep lists before deleting any older or failed image.
    for (const endpoint of deletions) execute(['--method', 'DELETE', endpoint]);
    console.log(`Removed ${deletions.length} obsolete image versions; retained ${manifests.length ? `${manifests.length} published release(s)` : 'one initial candidate per package for visibility setup'}.`);
}
module.exports = {obsoleteVersions, prune};
if (require.main === module) {
    assert.equal(process.env.GITHUB_REPOSITORY, 'MageLens/MageLens');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    prune();
}
