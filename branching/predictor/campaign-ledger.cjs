// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const workflow = require('../workflow-lease.cjs');
const digest = value => createHash('sha256').update(value).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(value);
function requireValue(condition, message) { if (!condition) throw new Error(`Campaign ledger: ${message}`); }
function encode(value) {
    function normalize(item) {
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
        if (typeof item === 'number') { requireValue(Number.isFinite(item), 'nonfinite metadata'); return item; }
        if (Array.isArray(item)) return item.map(normalize);
        requireValue(item && Object.getPrototypeOf(item) === Object.prototype, 'metadata must be plain JSON');
        return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]));
    }
    return JSON.stringify(normalize(value)) + '\n';
}
function location(workspace, cycle, lease) {
    requireValue(identifier(cycle), 'invalid cycle ID');
    const root = fs.realpathSync(workspace);
    if (lease) {
        requireValue(lease.lock === path.join(root, '.runtime/workflow.lock'), 'lease belongs to another workspace');
        workflow.join(lease.lock, lease);
    }
    const parts = ['.runtime', 'predictor', 'campaigns', cycle];
    let directory = root;
    for (const part of parts) {
        directory = path.join(directory, part);
        if (fs.existsSync(directory)) requireValue(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'linked or invalid campaign directory');
    }
    return directory;
}
function validateManifest(manifest) {
    requireValue(manifest.schemaVersion === 1 && identifier(manifest.cycleId), 'invalid manifest version or cycle ID');
    for (const field of ['candidateDigest', 'splitDigest', 'protocolDigest', 'sourceDigest', 'environmentDigest', 'ownedResourceDigest']) {
        requireValue(hash(manifest[field]), `missing ${field}`);
    }
    requireValue(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(manifest.extractorCommit), 'missing extractor commit');
    requireValue(typeof manifest.featureSchema === 'string' && manifest.featureSchema, 'missing feature schema');
    requireValue(Array.isArray(manifest.inventory) && manifest.inventory.length, 'empty inventory');
    const ids = new Set(), splits = new Map();
    for (const item of manifest.inventory) {
        requireValue(identifier(item.id) && !ids.has(item.id), 'duplicate or invalid case ID'); ids.add(item.id);
        requireValue(['train', 'validation', 'audit'].includes(item.split), 'unassigned split');
        requireValue(typeof item.group === 'string' && item.group, 'missing correlated group');
        requireValue(!splits.has(item.group) || splits.get(item.group) === item.split, 'correlated group crosses splits');
        splits.set(item.group, item.split);
        requireValue(['scheduled', 'blocked', 'inapplicable'].includes(item.disposition), 'missing disposition');
        requireValue(item.disposition === 'scheduled' || typeof item.reason === 'string' && item.reason, 'omitted case needs a reason');
        requireValue(['cypress', 'playwright'].includes(item.runner) && typeof item.timingBoundary === 'string' && item.timingBoundary, 'missing runner or timing boundary');
    }
    const scheduled = manifest.inventory.filter(item => item.disposition === 'scheduled').map(item => item.id).sort();
    requireValue(Array.isArray(manifest.runOrder) && encode([...manifest.runOrder].sort()) === encode(scheduled), 'run order must include every scheduled case exactly once');
    for (const field of ['maxMemoryBytes', 'maxDiskBytes', 'maxParallelRuns']) {
        requireValue(Number.isSafeInteger(manifest.budget?.[field]) && manifest.budget[field] > 0, `invalid ${field}`);
    }
}
function read(workspace, cycle) {
    const directory = location(workspace, cycle);
    const readFile = name => {
        const file = path.join(directory, name), stat = fs.lstatSync(file);
        requireValue(stat.isFile() && !stat.isSymbolicLink(), 'linked or invalid record');
        return fs.readFileSync(file, 'utf8');
    };
    const manifestBytes = readFile('manifest.json'), manifest = JSON.parse(manifestBytes);
    validateManifest(manifest);
    requireValue(manifest.cycleId === cycle, 'cycle identity changed');
    const manifestDigest = digest(manifestBytes), records = [];
    const names = fs.readdirSync(directory).filter(name => name !== 'manifest.json' && !name.startsWith('.pending-')).sort();
    let previous = manifestDigest;
    for (const [index, name] of names.entries()) {
        requireValue(name === `${String(index).padStart(8, '0')}.json`, 'missing or unexpected record');
        const bytes = readFile(name), record = JSON.parse(bytes);
        const {checksum, ...payload} = record;
        requireValue(checksum === digest(encode(payload)), 'record checksum changed');
        requireValue(record.sequence === index && record.previous === previous && record.manifestDigest === manifestDigest, 'record chain changed');
        requireValue(bytes === encode(record), 'noncanonical record bytes');
        validateEvent(manifest, records, record.event);
        records.push(record); previous = digest(bytes);
    }
    return {directory, manifest, manifestDigest, records, head: previous, state: records.at(-1)?.event.state ?? 'planned'};
}
const transitions = {planned: ['collecting', 'rejected'], collecting: ['collecting', 'audited', 'rejected'],
    audited: ['fitted', 'evaluated', 'rejected'], fitted: ['fitted', 'evaluated', 'rejected'], evaluated: ['rejected'], rejected: []};
function validateEvent(manifest, records, event) {
    requireValue(identifier(event.id), 'invalid event ID');
    const state = records.at(-1)?.event.state ?? 'planned';
    requireValue(transitions[state]?.includes(event.state), `invalid transition ${state} -> ${event.state}`);
    const start = Date.parse(event.startedAt), end = Date.parse(event.finishedAt);
    requireValue(Number.isFinite(start) && Number.isFinite(end) && end >= start, 'invalid timestamps');
    requireValue(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0, 'missing stage elapsed time');
    for (const field of ['peakMemoryBytes', 'diskBytes']) requireValue(Number.isSafeInteger(event.resources?.[field]) && event.resources[field] >= 0, `missing ${field}`);
    requireValue(typeof event.nextAction === 'string' && event.nextAction, 'missing next action');
    requireValue(!records.some(record => record.event.id === event.id), 'duplicate event ID');
    if (event.state === 'fitted') {
        requireValue(hash(event.datasetDigest) && hash(event.artifactDigest), 'fit needs immutable dataset and artifact digests');
        requireValue(Number.isSafeInteger(event.fitCount) && event.fitCount > 0 && typeof event.recipe === 'string' && event.recipe, 'missing fit count or recipe');
    }
    const attempts = records.flatMap(record => record.event.attempt ? [record.event.attempt] : []);
    if (event.attempt) {
        const attempt = event.attempt, prior = attempts.filter(item => item.id === attempt.id);
        requireValue(event.state === 'collecting' && identifier(attempt.id), 'attempt outside collection');
        requireValue(manifest.inventory.some(item => item.id === attempt.caseId && item.disposition === 'scheduled'), 'attempt is not scheduled');
        requireValue(hash(attempt.snapshotDigest), 'attempt needs a frozen forecast snapshot');
        requireValue(['started', 'passed', 'failed', 'interrupted', 'quarantined'].includes(attempt.status), 'invalid attempt status');
        requireValue(prior.length === 0 ? attempt.status === 'started' : prior.length === 1 && prior[0].status === 'started' && attempt.status !== 'started', 'attempt already finished or missing start');
        if (prior.length) requireValue(prior[0].caseId === attempt.caseId && prior[0].snapshotDigest === attempt.snapshotDigest, 'attempt identity changed');
        if (attempt.status === 'passed') {
            requireValue(hash(attempt.observationDigest), 'passed attempt needs an observation digest');
            requireValue(!attempts.some(item => item.observationDigest === attempt.observationDigest), 'observation reused');
        } else if (attempt.status !== 'started') requireValue(typeof attempt.reason === 'string' && attempt.reason, 'unsuccessful attempt needs a reason');
    }
    if (event.state === 'audited') {
        const finished = new Map(attempts.map(item => [item.id, item]));
        requireValue([...finished.values()].every(item => item.status !== 'started'), 'unfinished attempts need explicit reconciliation');
        requireValue(manifest.runOrder.every(id => [...finished.values()].some(item => item.caseId === id)), 'scheduled cases are missing');
        requireValue(hash(event.auditDigest), 'audit report digest required');
    }
}
function create(workspace, manifest, lease) {
    requireValue(lease, 'workflow lease required'); validateManifest(manifest);
    const directory = location(workspace, manifest.cycleId, lease);
    fs.mkdirSync(path.dirname(directory), {recursive: true, mode: 0o700});
    const temporary = path.join(path.dirname(directory), `.pending-${randomUUID()}`);
    fs.mkdirSync(temporary, {mode: 0o700});
    try {
        const fd = fs.openSync(path.join(temporary, 'manifest.json'), 'wx', 0o600);
        try { fs.writeFileSync(fd, encode(manifest)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        requireValue(!fs.existsSync(directory), 'cycle already exists');
        fs.renameSync(temporary, directory);
        const parent = fs.openSync(path.dirname(directory), 'r');
        try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary, {recursive: true}); }
    return read(workspace, manifest.cycleId);
}
function append(workspace, cycle, event, lease) {
    requireValue(lease, 'workflow lease required'); location(workspace, cycle, lease);
    const ledger = read(workspace, cycle), existing = ledger.records.find(record => record.event.id === event.id);
    if (existing) { requireValue(encode(existing.event) === encode(event), 'event ID reused with different content'); return ledger; }
    validateEvent(ledger.manifest, ledger.records, event);
    const payload = {sequence: ledger.records.length, previous: ledger.head, manifestDigest: ledger.manifestDigest, event};
    const bytes = encode({...payload, checksum: digest(encode(payload))});
    const temporary = path.join(ledger.directory, `.pending-${randomUUID()}`);
    const target = path.join(ledger.directory, `${String(ledger.records.length).padStart(8, '0')}.json`);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.linkSync(temporary, target); } finally { fs.unlinkSync(temporary); }
    const parent = fs.openSync(ledger.directory, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    return read(workspace, cycle);
}
module.exports = {create, read, append};
