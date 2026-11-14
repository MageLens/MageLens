// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const {digest} = require('../identity.cjs');
const {accuracyMetrics} = require('./accuracy.cjs');
const {PLAYWRIGHT_TEST_TIMING_BOUNDARY, SEGMENT_TIMING_BOUNDARY} = require('./prefix-measurement.cjs');

function bindCatalogSegment(manifest, candidateId) {
    const {verifySources, playwrightCoverageAdapter} = require('../automatic.cjs');
    verifySources(manifest);
    const checkpoint = manifest.checkpoints.find(entry => entry.id === candidateId);
    assert.ok(checkpoint && checkpoint.consumers.length >= 2, 'Expected a discovered duplicate prefix');
    const adapter = playwrightCoverageAdapter(manifest);
    assert.ok(adapter.supportsCheckpoint(checkpoint), 'Catalog prefix is not restorable');
    const {trainingSnapshot: snapshot} = manifest.assessment.stages[candidateId];
    assert.equal(snapshot?.timingBoundary, SEGMENT_TIMING_BOUNDARY);
    const {representative, fromDepth, toDepth} = snapshot.segment;
    assert.equal(representative, checkpoint.representative);
    assert.equal(toDepth, checkpoint.depth);
    assert.ok(Number.isInteger(fromDepth) && fromDepth >= 0 && fromDepth < toDepth);
    const test = manifest.tests.find(entry => entry.id === representative);
    return {
        snapshot,
        prepare: provider => adapter.execute(test, 0, fromDepth, provider),
        execute: provider => adapter.execute(test, fromDepth, toDepth, provider),
        async verifyContinuation(provider) {
            for (const id of checkpoint.consumers) {
                const consumer = manifest.tests.find(entry => entry.id === id);
                assert.equal(consumer.steps.slice(0, toDepth).length, toDepth);
                assert.ok(consumer.steps.slice(0, toDepth).every((step, index) =>
                    step.fingerprint === test.steps[index].fingerprint), 'Catalog consumers have different prefix work');
            }
            await adapter.execute(test, toDepth, test.steps.length, provider);
            provider.browserState.check();
            verifySources(manifest);
        }
    };
}

// The caller supplies the pinned protocol separately from the collected observations.
function evaluateCatalogQualification({protocol, protocolDigest, loaded, observations}) {
    assert.equal(digest(protocol), protocolDigest, 'Catalog qualification protocol changed');
    assert.equal(protocol.modelId, loaded.id, 'Catalog qualification model changed');
    assert.equal(protocol.runner, 'playwright');
    const boundaries = {test: PLAYWRIGHT_TEST_TIMING_BOUNDARY, prefix: SEGMENT_TIMING_BOUNDARY};
    assert.ok(Object.hasOwn(boundaries, protocol.unit));
    assert.equal(protocol.timingBoundary, boundaries[protocol.unit]);

    const groups = new Set(protocol.trainingGroups);
    assert.equal(groups.size, 2, 'Expected two independent catalog development groups');
    assert.deepEqual([...groups].sort(), Object.keys(loaded.model.training?.folds ?? {}).sort(),
        'Catalog development groups differ from the fitted model');
    assert.ok(Array.isArray(protocol.fixtureDigests) && new Set(protocol.fixtureDigests).size === 2,
        'Expected both catalog fixture states');
    assert.ok(Array.isArray(protocol.cases) && protocol.cases.length > 0);
    const seen = new Set();
    const auditGroups = new Map();
    const measured = new Map(observations.map(row => [row.caseId, row]));
    assert.equal(measured.size, observations.length, 'Duplicate catalog observation');
    assert.equal(measured.size, protocol.cases.length, 'Incomplete catalog observation inventory');
    const strata = new Map();
    const {predict} = require('./index.cjs');
    for (const entry of protocol.cases) {
        assert.ok(!seen.has(entry.id), 'Duplicate catalog qualification case');
        seen.add(entry.id);
        assert.ok(['validation', 'audit'].includes(entry.split));
        assert.ok(protocol.fixtureDigests.includes(entry.fixtureDigest));
        assert.ok(!groups.has(entry.group), 'Development group reused in qualification');
        assert.ok(!auditGroups.has(entry.group) || auditGroups.get(entry.group) === entry.split,
            'Catalog group crosses validation and audit');
        auditGroups.set(entry.group, entry.split);
        const row = measured.get(entry.id);
        assert.ok(row && row.eligible === true && row.attempts === 1 && row.sourceVerified === true &&
            row.suitePassed === true && row.coverageVerified === true, 'Catalog observation failed execution audit');
        if (protocol.unit === 'prefix')
            assert.ok(row.providerAuditPassed === true, 'Catalog prefix failed retained-provider audit');
        const {snapshot} = entry;
        assert.equal(row.forecastDigest, digest(snapshot), 'Catalog observation does not match its frozen inputs');
        assert.equal(snapshot.group, entry.group);
        assert.equal(row.sourceDigest, snapshot.sourceDigest);
        assert.equal(row.environmentDigest, snapshot.environmentDigest);
        assert.equal(row.fixtureDigest, entry.fixtureDigest);
        assert.equal(snapshot.modelId, loaded.id);
        assert.equal(snapshot.runner, protocol.runner);
        assert.equal(snapshot.unit, protocol.unit);
        assert.equal(snapshot.timingBoundary, protocol.timingBoundary);
        const prediction = predict(snapshot, loaded, {shadow: true, transfer: true});
        assert.ok(prediction.domainMatched && prediction.environmentKnown && !prediction.outOfRange,
            'Catalog forecast is outside its trained domain');
        const stratum = entry.split + '/' + entry.fixtureDigest;
        if (!strata.has(stratum)) strata.set(stratum, []);
        strata.get(stratum).push({eligible: true, actualMs: row.actualMs, prediction});
    }
    assert.equal(auditGroups.size, 2);
    assert.equal(new Set(auditGroups.values()).size, 2, 'Both validation and prospective audit are required');
    for (const split of ['validation', 'audit'])
        for (const fixture of protocol.fixtureDigests)
            assert.equal(strata.get(split + '/' + fixture)?.length, 2, 'Missing catalog repetitions for a fixture state');
    const results = Object.fromEntries([...strata].map(([stratum, rows]) => [stratum, accuracyMetrics(rows)]));
    return {protocolDigest, modelId: loaded.id, passed: Object.values(results).every(row => row.meetsErrorTarget), strata: results};
}

module.exports = {bindCatalogSegment, evaluateCatalogQualification};
