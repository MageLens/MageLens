// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {kinds, inputs, platforms, repository, imageRegistry, manifestFilename, expirationProtocol} = require('../../bin/image-inputs.cjs');
const digest = letter => 'sha256:' + letter.repeat(64);
const root = path.join(__dirname, '../..');
const now = Date.parse('2026-06-01T00:00:00Z');
const oldImage = (id, name) => ({id, name, created_at: '2025-01-01T00:00:00Z'});
const dayMs = 24 * 60 * 60 * 1000;
const releasesEndpoint = `repos/${repository}/releases`;
const packagesEndpoint = `orgs/${repository.split('/')[0]}/packages/container`;
const packageKind = endpoint => endpoint.slice(`${packagesEndpoint}/`.length).split('/')[0];
const published = {schema: 1, platform: 'linux/amd64', version: require('../../package.json').version,
    images: Object.fromEntries(kinds.map(kind => [kind, {inputs: inputs(root, kind), digest: digest('a')}]))};

function retentionFixture({count = 6, ageDays = i => (count + 1 - i) * 30, protocol = expirationProtocol} = {}) {
    const releases = [], assets = {}, inventories = Object.fromEntries(kinds.map(kind => [kind, []]));
    for (let i = 1; i <= count; i++) {
        const version = `2.0.${i}`;
        const published_at = new Date(now - ageDays(i) * dayMs).toISOString();
        releases.push({id: i, tag_name: `v${version}`, published_at, assets: [{id: 100 + i, name: manifestFilename}]});
        const entries = Object.fromEntries(platforms.map((platform, p) => [platform, Object.fromEntries(kinds.map(kind => {
            const entry = {inputs: published.images[kind].inputs, digest: digest((i * 2 + p).toString(16))};
            inventories[kind].push(oldImage(i * 10 + p, entry.digest));
            return [kind, entry];
        }))]));
        assets[100 + i] = {schema: 1, ...(protocol === null ? {} : {expirationProtocol: protocol}), version, platform: 'linux/amd64', images: entries['linux/amd64'], platforms: entries};
    }
    for (const kind of kinds) inventories[kind].push(oldImage(999, digest('0')));
    return {releases, assets, inventories};
}

function mockApi(overrides = {}) {
    const calls = [];
    const release = {id: 1, tag_name: `v${published.version}`, published_at: overrides.published_at || '2026-06-01T00:00:00Z', assets: [{id: 123, name: manifestFilename}]};
    const releases = structuredClone(overrides.releases || (overrides.noManifest ? [] : [release, ...(overrides.historicalReleases || [])]));
    const assets = structuredClone(overrides.assets || {});
    const inventories = Object.fromEntries(kinds.map(kind => [kind, structuredClone(
        overrides.packageVersions ? overrides.packageVersions(`${packagesEndpoint}/${kind}/versions?per_page=100`).flat()
            : overrides.inventories?.[kind] || [oldImage(1, overrides.missingLatest ? digest('c') : digest('a')), oldImage(2, digest('b')), oldImage(3, digest('0'))]
    )]));
    let renameCount = 0;
    const execute = (args, input) => {
        calls.push(args);
        const endpoint = args.at(-1);
        if (args.includes('DELETE')) {
            const kind = packageKind(endpoint);
            const id = Number(endpoint.split('/').at(-1));
            inventories[kind] = inventories[kind].filter(image => image.id !== id);
            return '';
        }
        if (args.includes('POST')) {
            if (overrides.uploadFailure) throw new Error('Expiration upload failed (HTTP 403)');
            const releaseId = Number(new URL(endpoint).pathname.split('/').at(-2));
            const target = releases.find(r => r.id === releaseId);
            assert.ok(target, 'Expiration must target the correct release ID');
            const asset = {id: 10000 + releaseId, name: 'images-expired.json'};
            assets[asset.id] = JSON.parse(input);
            target.assets.push(asset);
            return JSON.stringify(asset);
        }
        if (args.includes('PATCH')) {
            renameCount++;
            if (overrides.failSecondRenameOnce && renameCount === 2) throw new Error('Expiration rename failed (HTTP 503)');
            if (overrides.renameFailure) throw new Error('Expiration rename failed (HTTP 403)');
            const assetId = Number(endpoint.split('/').at(-1));
            const asset = releases.flatMap(r => r.assets).find(a => a.id === assetId);
            asset.name = args.find(arg => arg.startsWith('name=')).slice(5);
            return JSON.stringify(asset);
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
            const data = Object.hasOwn(assets, assetId) ? assets[assetId] : published;
            return typeof data === 'string' ? data : JSON.stringify(data);
        }
        if (endpoint.includes('/versions?')) {
            const versions = inventories[packageKind(endpoint)];
            return JSON.stringify([versions.slice(0, 1), versions.slice(1)]);
        }
        return JSON.stringify({repository: {full_name: overrides.otherRepository ? 'Other/Project' : repository}});
    };
    return {
        calls, execute,
        versions: kind => structuredClone(inventories[kind]),
        release: tag => JSON.parse(execute([`${releasesEndpoint}/tags/${tag}`])),
        asset: id => JSON.parse(execute([`${releasesEndpoint}/assets/${id}`]))
    };
}
function retireDuringInstallation() {
    const {prune, RETIREMENT_GRACE_PERIOD_MS} = require('./prune-images.cjs');
    const fixture = JSON.parse(fs.readFileSync(process.env.MOCK_RETIREMENT_FIXTURE));
    const selectedBeforeRetirement = JSON.parse(fs.readFileSync('.runtime/prebuilt-images.json'));
    const api = mockApi(fixture);
    const tag = fixture.releases[0].tag_name;
    prune(api.execute, {now});
    const gracePreserved = kinds.every(kind => api.versions(kind).some(image => image.id === 10));
    prune(api.execute, {now: now + RETIREMENT_GRACE_PERIOD_MS});
    const asset = api.release(tag).assets.find(asset => asset.name === manifestFilename);
    const retired = api.asset(asset.id);
    const images = kinds.flatMap(kind => api.versions(kind).map(image => `${imageRegistry}/${kind}@${image.name}`));
    const response = {status: 200, manifest: retired};
    switch (process.env.MOCK_CONFIRMATION) {
        case 'active': response.manifest = fixture.assets[101]; break;
        case 'wrong version': response.manifest = {...retired, version: '2.0.99'}; break;
        case 'malformed': response.manifest = {}; break;
        case 'provenance': response.manifest = {...fixture.assets[101], images: {}}; break;
        case '403': response.status = 403; break;
        case '404': response.status = 404; break;
        case '503': response.status = 503; break;
        case 'network': response.error = 'Network unavailable'; break;
    }
    fs.writeFileSync(process.env.MOCK_MANIFEST_FILE, JSON.stringify(response));
    fs.writeFileSync(process.env.MOCK_REGISTRY_FILE, JSON.stringify(images));
    fs.writeFileSync(process.env.MOCK_RETIREMENT_RESULT, JSON.stringify({
        selectedBeforeRetirement, gracePreserved,
        removed: kinds.every(kind => !api.versions(kind).some(image => image.id === 10)), retired
    }));
    fs.appendFileSync(process.env.MOCK_LOG, 'retirement-completed\n');
}

module.exports = {
    digest, root, now, oldImage, dayMs, releasesEndpoint, packagesEndpoint,
    packageKind, published, retentionFixture, mockApi, retireDuringInstallation
};
