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
    assert.equal(provider.state,null);assert.deepEqual(fs.readdirSync(root),[]);
});
test('failed restoration cannot produce a usable calibration and still cleans the backend',async t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-calibration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const provider=new FixtureProvider();provider.restore=async()=>{throw new Error('restore failed');};
    const report=await measure({provider,root,samples:1,warmup:async()=>{}});
    assert.equal(report.status,'failed');assert.ok(report.errors.some(error=>error.message==='restore failed'));
    assert.equal(provider.state,null);assert.deepEqual(fs.readdirSync(root),[]);
});
