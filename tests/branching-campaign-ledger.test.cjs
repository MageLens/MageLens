// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const ledger = require('../branching/predictor/campaign-ledger.cjs');
const workflow = require('../branching/workflow-lease.cjs');
const hash = character => character.repeat(64);
function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-campaign-'));
    fs.mkdirSync(path.join(root, '.runtime'));
    const lease = workflow.acquire(root);
    t.after(() => { workflow.release(lease); fs.rmSync(root, {recursive: true}); });
    const manifest = {schemaVersion: 1, cycleId: 'cycle-1', candidateDigest: hash('a'), splitDigest: hash('b'),
        protocolDigest: hash('c'), sourceDigest: hash('d'), environmentDigest: hash('e'), ownedResourceDigest: hash('f'),
        extractorCommit: 'a'.repeat(40), featureSchema: 'fixture/v1',
        inventory: ['train', 'validation', 'audit'].map(split => ({id: split, group: split, split,
            disposition: 'scheduled', runner: 'cypress', timingBoundary: 'test/v1'})),
        runOrder: ['train', 'validation', 'audit'], budget: {maxMemoryBytes: 1024, maxDiskBytes: 4096, maxParallelRuns: 1}};
    return {root, lease, manifest};
}
const event = (id, state = 'collecting', extra = {}) => ({id, state, startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:01Z', elapsedMs: 1000, resources: {peakMemoryBytes: 512, diskBytes: 1000},
    nextAction: 'Continue the frozen campaign', ...extra});
function attempt(caseId, status, extra = {}) { return {id: caseId + '-1', caseId, status, snapshotDigest: hash('a'), ...extra}; }

test('campaign journal persists immutable plans and replays idempotent events after reopening', t => {
    const {root, lease, manifest} = setup(t);
    const created = ledger.create(root, manifest, lease);
    assert.equal(created.state, 'planned');
    assert.throws(() => ledger.create(root, manifest, lease), /already exists/);
    const started = event('start', 'collecting', {attempt: attempt('train', 'started')});
    const first = ledger.append(root, manifest.cycleId, started, lease);
    assert.equal(ledger.append(root, manifest.cycleId, started, lease).head, first.head);
    assert.equal(ledger.read(root, manifest.cycleId).records.length, 1);
    assert.throws(() => ledger.append(root, manifest.cycleId, {...started, elapsedMs: 2}, lease), /different content/);
    assert.throws(() => ledger.append(root, manifest.cycleId, event('audit', 'audited', {auditDigest: hash('b')}), lease), /unfinished/);
    ledger.append(root, manifest.cycleId, event('interrupted', 'collecting', {attempt: attempt('train', 'interrupted', {reason: 'Runner terminated'})}), lease);
    assert.equal(ledger.read(root, manifest.cycleId).records.at(-1).event.attempt.status, 'interrupted');
});

test('attempt accounting preserves failures, rejects changed forecasts and forbids duplicate labels', t => {
    const {root, lease, manifest} = setup(t); ledger.create(root, manifest, lease);
    const append = value => ledger.append(root, manifest.cycleId, value, lease);
    assert.throws(() => append(event('finish', 'collecting', {attempt: attempt('train', 'passed', {observationDigest: hash('b')})})), /missing start/);
    append(event('start', 'collecting', {attempt: attempt('train', 'started')}));
    assert.throws(() => append(event('change', 'collecting', {attempt: attempt('train', 'passed', {snapshotDigest: hash('c'), observationDigest: hash('b')})})), /identity changed/);
    append(event('finish', 'collecting', {attempt: attempt('train', 'passed', {observationDigest: hash('b')})}));
    append(event('start-validation', 'collecting', {attempt: attempt('validation', 'started')}));
    assert.throws(() => append(event('duplicate', 'collecting', {attempt: attempt('validation', 'passed', {observationDigest: hash('b')})})), /observation reused/);
    append(event('fail-validation', 'collecting', {attempt: attempt('validation', 'failed', {reason: 'Original assertion failed'})}));
    assert.throws(() => append(event('audit', 'audited', {auditDigest: hash('d')})), /scheduled cases are missing/);
    append(event('start-audit', 'collecting', {attempt: attempt('audit', 'started')}));
    append(event('quarantine-audit', 'collecting', {attempt: attempt('audit', 'quarantined', {reason: 'Provider audit failed'})}));
    append(event('audited', 'audited', {auditDigest: hash('d')}));
    assert.throws(() => append(event('fit', 'fitted')), /immutable dataset/);
    append(event('fit', 'fitted', {datasetDigest: hash('b'), artifactDigest: hash('c'), fitCount: 1, recipe: 'fixture'}));
    append(event('evaluation', 'evaluated'));
    assert.throws(() => append(event('promotion', 'qualified')), /invalid transition/);
    append(event('reject', 'rejected'));
    assert.equal(ledger.read(root, manifest.cycleId).state, 'rejected');
});

test('campaign writes require this workspace lease and immutable disjoint group assignments', t => {
    const {root, lease, manifest} = setup(t);
    assert.throws(() => ledger.create(root, manifest), /lease required/);
    assert.throws(() => ledger.create(root, manifest, {...lease, token: 'other'}), /does not own/);
    assert.throws(() => ledger.create(root, {...manifest, inventory: manifest.inventory.map(item => ({...item, group: 'shared'}))}, lease), /crosses splits/);
    assert.throws(() => ledger.create(root, {...manifest, runOrder: ['train', 'validation']}, lease), /every scheduled case/);
    const blocked = {...manifest, inventory: manifest.inventory.map(item => ({...item, disposition: 'blocked'})), runOrder: []};
    assert.throws(() => ledger.create(root, blocked, lease), /needs a reason/);
});

test('version 2 ledger persists the exact split consumed by training', t => {
    const {root,lease,manifest} = setup(t);
    manifest.schemaVersion = 2;
    const bytes = ledger.splitBytes(manifest.inventory);
    assert.equal(ledger.splitBytes([...manifest.inventory].reverse()),bytes);
    assert.throws(() => ledger.create(root,manifest,lease),/frozen split digest/);
    manifest.splitDigest = createHash('sha256').update(bytes).digest('hex');
    const created = ledger.create(root,manifest,lease);
    const file = path.join(created.directory,'split.json');
    assert.equal(fs.readFileSync(file,'utf8'),bytes);
    fs.appendFileSync(file,'\n');
    assert.throws(() => ledger.read(root,manifest.cycleId),/frozen split file changed/);
});

test('journal rejects altered history and symlinks while ignoring unpublished crash remnants', t => {
    const {root, lease, manifest} = setup(t);
    const created = ledger.create(root, manifest, lease);
    ledger.append(root, manifest.cycleId, event('start'), lease);
    fs.writeFileSync(path.join(created.directory, '.pending-crash'), '{');
    assert.equal(ledger.read(root, manifest.cycleId).records.length, 1);
    const file = path.join(created.directory, '00000000.json');
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, original.replace('"sequence":0', '"sequence":2'));
    assert.throws(() => ledger.read(root, manifest.cycleId), /checksum changed/);
    fs.unlinkSync(file); fs.symlinkSync(path.join(created.directory, 'manifest.json'), file);
    assert.throws(() => ledger.read(root, manifest.cycleId), /linked/);
});
