// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {kinds, inputs} = require('../bin/image-inputs.cjs');
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
        if (endpoint.endsWith('/releases/latest')) {
            if (overrides.networkFailure) throw new Error('Network unavailable');
            return JSON.stringify({tag_name: `v${published.version}`, assets: overrides.noManifest ? [] : [{id: 123, name: 'images.json'}]});
        }
        if (endpoint.includes('/releases/assets/')) return JSON.stringify(published);
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
    assert.equal(calls.filter(args => args.includes('--paginate')).length, 3);
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
test('release manifest accepts only all three images from the current commit, run and attempt', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-release-manifest-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const env = {RELEASE_SHA: 'candidate', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2'};
    for (const kind of kinds) fs.writeFileSync(path.join(directory, `${kind}.json`), JSON.stringify({kind, ...published.images[kind], sha: 'candidate', run: '123', attempt: '2'}));
    assert.deepEqual(manifest(directory, root, env), published);
    for (const key of Object.keys(env)) assert.throws(() => manifest(directory, root, {...env, [key]: 'stale'}), /Wrong release/);
    fs.rmSync(path.join(directory, 'php.json'));
    assert.throws(() => manifest(directory, root, env), /ENOENT/);
});
