// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {kinds, validateManifest} = require('../../bin/image-inputs.cjs');
const api = args => execFileSync('gh', ['api', ...args], {encoding: 'utf8'});
function obsoleteVersions(versions, keepDigest) {
    if (keepDigest) assert.ok(versions.some(version => version.name === keepDigest), 'Published image missing; refusing cleanup');
    for (const version of versions) {
        assert.ok(Number.isSafeInteger(version.id) && version.id > 0, 'Invalid package version');
        assert.match(version.name, /^sha256:[a-f0-9]{64}$/);
    }
    return versions.filter(version => version.name !== keepDigest).map(version => version.id);
}
function prune(execute = api) {
    // Read the actually published release, including after a partially failed run.
    // A network/authentication error must never be interpreted as an empty keep list.
    const latest = JSON.parse(execute(['repos/MageLens/MageLens/releases/latest']));
    const asset = latest.assets.find(asset => asset.name === 'images.json');
    let manifest;
    if (asset) {
        assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0);
        manifest = validateManifest(JSON.parse(execute(['-H', 'Accept: application/octet-stream', `repos/MageLens/MageLens/releases/assets/${asset.id}`])));
    }
    if (manifest) assert.equal(latest.tag_name, `v${manifest.version}`, 'Latest release manifest has the wrong version');
    const deletions = [];
    for (const kind of kinds) {
        const endpoint = `orgs/MageLens/packages/container/${kind}`;
        let info;
        try { info = JSON.parse(execute([endpoint])); }
        catch (error) {
            // A failed first build may not have created all three packages yet.
            if (!manifest && String(error.stderr).includes('HTTP 404')) continue;
            throw error;
        }
        assert.equal(info.repository?.full_name, 'MageLens/MageLens', 'Refusing to prune a package owned by another repository');
        const versions = JSON.parse(execute(['--paginate', '--slurp', `${endpoint}/versions?per_page=100`])).flat();
        // GHCR refuses deletion of the last tagged version. Before the first
        // image release, retain one candidate per package for visibility setup.
        const keepDigest = manifest?.images[kind].digest || versions.reduce((newest, version) => !newest || version.id > newest.id ? version : newest, null)?.name;
        for (const id of obsoleteVersions(versions, keepDigest)) deletions.push(`${endpoint}/versions/${id}`);
    }
    // Validate all three keep lists before deleting any older or failed image.
    for (const endpoint of deletions) execute(['--method', 'DELETE', endpoint]);
    console.log(`Removed ${deletions.length} obsolete image versions; retained ${manifest ? 'the latest published release' : 'one initial candidate per package for visibility setup'}.`);
}
module.exports = {obsoleteVersions, prune};
if (require.main === module) {
    assert.equal(process.env.GITHUB_REPOSITORY, 'MageLens/MageLens');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    prune();
}
