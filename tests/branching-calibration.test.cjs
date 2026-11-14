// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {FixtureProvider}=require('./fixtures/branching/provider.cjs');
const {measure}=require('../branching/calibration.cjs');
test('explicit calibration measures the real store lifecycle and cleans its snapshots',async t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-calibration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const provider=new FixtureProvider();let warmed=0;
    const report=await measure({provider,root,samples:3,warmup:async p=>{warmed++;p.state.db.customer='ready';}});
    assert.equal(report.status,'passed');assert.equal(warmed,3);
    assert.equal(report.costs.captures.length,3);assert.equal(report.costs.restores.length,3);
    assert.equal(report.costs.resets.length,3);assert.equal(report.releases.length,3);
    assert.equal(report.calibration.requestedSamples,3);
    assert.match(report.calibration.profileDigest,/^[a-f0-9]{64}$/);
    for (const [index,sample] of report.calibration.samples.entries()) {
        assert.equal(sample.stage,report.costs.captures[index].stage);
        assert.equal(sample.status,'passed');
        assert.equal(sample.artifactCount,1);
        assert.ok(sample.snapshotBytes>0);
        assert.ok(sample.phases.capture>=0 && sample.phases.restore>=0 && sample.phases.release>=0);
        assert.equal(sample.phases.cleanup,undefined);
    }
    assert.equal(provider.state,null);assert.deepEqual(fs.readdirSync(root),[]);
});
test('failed restoration cannot produce a usable calibration and still cleans the backend',async t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-calibration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const provider=new FixtureProvider();provider.restore=async()=>{throw new Error('restore failed');};
    const report=await measure({provider,root,samples:1,warmup:async()=>{}});
    assert.equal(report.status,'failed');assert.ok(report.errors.some(error=>error.message==='restore failed'));
    assert.equal(report.calibration.samples[0].status,'incomplete');
    assert.equal(report.calibration.samples[0].phases.cleanup,undefined);
    assert.equal(provider.state,null);assert.deepEqual(fs.readdirSync(root),[]);
});
test('qualification measurement times the frozen increment and requires a passing restored continuation', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magelens-qualification-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const {digest} = require('../branching/identity.cjs');
    const {samples} = require('../branching/baseline.cjs');
    const {SEGMENT_TIMING_BOUNDARY} = require('../branching/predictor/prefix-measurement.cjs');
    const snapshot = {unit: 'prefix', timingBoundary: SEGMENT_TIMING_BOUNDARY};
    for (const valid of [true, false]) {
        const report = await measure({provider: new FixtureProvider(), root, samples: 1, warmup: async () => {},
            qualificationSegment: {
                snapshot,
                runtimeContext: () => ({phpfpm:{memoryBytes:2147483648}}),
                prepare: async provider => { provider.state.db.customer = 'prepared'; },
                execute: async provider => {
                    assert.equal(provider.state.db.customer, 'prepared');
                    provider.state.db.customer = 'checkpoint';
                },
                verifyContinuation: async provider => {
                    assert.equal(provider.state.db.customer, 'checkpoint');
                    if (!valid) throw new Error('Continuation failed');
                }
            }});
        assert.equal(report.kind, 'catalog-qualification-measurement');
        assert.equal(report.status, valid ? 'passed' : 'failed');
        assert.equal(report.calibration.samples[0].segment.forecastDigest, digest(snapshot));
        assert.deepEqual(report.calibration.samples[0].runtimeContext, {phpfpm:{memoryBytes:2147483648}});
        assert.ok(report.calibration.samples[0].segment.workMs > 0);
        assert.equal(samples(report), null);
        assert.deepEqual(fs.readdirSync(root), []);
    }
});
