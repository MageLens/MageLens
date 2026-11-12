// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const baseline=require('../branching/baseline.cjs');
function fixture(t) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-baseline-'));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    return {root,store:new baseline.Store({workspace:root,key:'fixture-hardware-and-database'})};
}
function report(restores=[100,200,300]) {
    return {status:'passed',results:[{status:'passed'}],phases:[{kind:'checkpoint',report:{status:'passed',errors:[],
        counts:{fallbacks:0,failures:0,blockedSpecs:0},checkpoints:[{stage:'shared'}],releases:[{stage:'shared'}],
        costs:{captures:[{ms:50}],restores:restores.map(ms=>({ms})),releases:[{ms:2}],resets:[80]},
        phases:{prepare:30,cleanup:40},providerDiagnostics:{retainedServices:{schemasRemoved:true,grantsRestored:true}}}}]};
}
test('fresh projects use fixed defaults with double overhead and an added twenty percent margin',t=>{
    const {store}=fixture(t),loaded=store.load();
    assert.equal(loaded.source,'default');assert.equal(loaded.baseline.overheadMultiplier,2);
    assert.equal(loaded.baseline.overheadMargin,.2);
    assert.ok(loaded.baseline.captureMs>0);assert.equal(fs.existsSync(store.file),false);
});
test('successful runs learn weighted operation averages for subsequent runs without changing the current plan',t=>{
    const {store}=fixture(t),before=store.load();
    const first=store.update(report());assert.equal(first.updated,true);
    assert.equal(store.load().baseline.restoreMs,200);
    store.update(report([400]));
    const learned=store.load();assert.equal(learned.source,'measured');assert.equal(learned.baseline.restoreMs,250);
    assert.equal(learned.samples.restoreMs,4);assert.equal(learned.baseline.backendMs,70);
    assert.equal(before.source,'default');assert.equal(before.baseline.restoreMs,baseline.defaults.restoreMs);
    assert.equal(learned.baseline.resetMs,baseline.defaults.resetMs,'unobserved resets retain defaults');
});
test('test work and environment setup never train checkpoint overhead',t=>{
    const {store}=fixture(t),short=report(),long=report();
    const expected=baseline.samples(short);
    long.wallMs=900000;
    long.setupDiagnostics={wallMs:120000};
    Object.assign(long.phases[0].report.phases,{prefix:124000,suffix:90000,terminalState:1000});
    long.phases[0].report.segments=[{wallMs:124000}];
    long.phases.unshift({kind:'native',report:{status:'passed',wallMs:600000}});
    assert.deepEqual(baseline.samples(long),expected);
    store.update(short);
    const before=store.load();
    store.update(long);
    assert.deepEqual(store.load().baseline,before.baseline);
    assert.equal(store.load().decisionBaselineMs,before.decisionBaselineMs);
    const calibration={...long.phases[1].report,kind:'baseline-calibration',wallMs:900000};
    calibration.phases={...calibration.phases,warmup:500000};
    assert.deepEqual(baseline.samples(calibration),expected);
});
test('restore calibration uses per-operation cost and keeps one-time lifecycle costs separate',t=>{
    const {store}=fixture(t),input=report(Array(8).fill(7500));
    const phase=input.phases[0].report;
    phase.costs.captures=[{ms:3000}];
    phase.costs.releases=[{ms:8}];
    phase.costs.resets=[16500];
    phase.phases={prepare:4500,cleanup:12000,prefix:124000,suffix:22000,restore:60000};
    store.update(input);
    const learned=store.load();
    assert.equal(learned.baseline.restoreMs,7500);
    assert.equal(learned.samples.restoreMs,8);
    assert.equal(learned.baseline.captureMs,3000);
    assert.equal(learned.baseline.firstResetMs,16500);
    assert.equal(learned.baseline.backendMs,16500);
    assert.equal(learned.decisionBaselineMs,(33000+3000+7500+8)*2*1.2+50);
});
test('failed runs, fallback, missing releases and incomplete cleanup cannot train the baseline',t=>{
    const {store}=fixture(t);store.update(report());const saved=fs.readFileSync(store.file,'utf8');
    for(const mutate of [r=>{r.status='failed';},r=>{r.results[0].status='skipped';},
        r=>{r.phases[0].report.counts.fallbacks=1;},r=>{r.phases[0].report.releases=[];},
        r=>{r.phases[0].report.providerDiagnostics.retainedServices.grantsRestored=false;}]) {
        const input=report();mutate(input);assert.equal(store.update(input).updated,false);
        assert.equal(fs.readFileSync(store.file,'utf8'),saved);
    }
    assert.equal(store.update({status:'passed',results:[{status:'passed'}],phases:[]}).updated,false);
});
test('explicit calibration can replace measurements while automatic updates can be disabled',t=>{
    const {root,store}=fixture(t);store.update(report());
    const manual=new baseline.Store({workspace:root,key:'fixture-hardware-and-database',updateOnSuccess:false});
    assert.equal(manual.update(report([900])).updated,false);
    assert.equal(manual.load().baseline.restoreMs,200);
    assert.equal(manual.update(report([900]),{explicit:true,replace:true}).updated,true);
    assert.equal(manual.load().baseline.restoreMs,900);assert.equal(manual.load().samples.restoreMs,1);
});
test('changed environments and baseline versions use defaults; malformed or linked files never train',t=>{
    const {root,store}=fixture(t);store.update(report());
    assert.equal(new baseline.Store({workspace:root,key:'different-database-size'}).load().source,'default');
    const saved=JSON.parse(fs.readFileSync(store.file));saved.defaultVersion='old';fs.writeFileSync(store.file,JSON.stringify(saved));
    assert.equal(store.load().source,'default');
    fs.writeFileSync(store.file,'invalid');assert.equal(store.load().source,'default');
    fs.unlinkSync(store.file);const target=path.join(root,'preserved');fs.writeFileSync(target,'do not change');fs.symlinkSync(target,store.file);
    assert.equal(store.load().source,'default');assert.throws(()=>store.update(report()),/symbolic|regular/i);
    assert.equal(fs.readFileSync(target,'utf8'),'do not change');
});
test('overhead history detects a regression before averaging and retains the original reference',t=>{
    const {store}=fixture(t);store.update(report([100]));
    const changed=store.update(report([150]));
    assert.ok(changed.regressions.some(item=>item.metric==='restoreMs'&&item.referenceMs===100&&item.observedMs===150));
    assert.equal(changed.baseline.restoreMs,125);
    const again=store.update(report([140]));
    assert.ok(again.regressions.some(item=>item.metric==='restoreMs'&&item.referenceMs===100));
    const history=fs.readFileSync(store.historyFile,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(history.length,3);assert.equal(history[1].previousBaseline.restoreMs,100);
    assert.equal(history[1].observed.restoreMs,150);assert.equal(history[1].nextBaseline.restoreMs,125);
});

test('the root decision baseline controls bootstrap costs and calibration reports its adjusted value', t => {
    const root = require('../branching-baseline.json');
    assert.ok(Math.abs(baseline.decisionBaselineMs(baseline.defaults) - root.checkpointDecisionBaselineMs) < 0.001);
    const target = root.checkpointDecisionBaselineMs * 2;
    const scaled = baseline.withDecisionBaseline(target);
    assert.ok(Math.abs(baseline.decisionBaselineMs(scaled) - target) < 0.001);
    for (const value of [NaN, Infinity, -1, 0, '125000', baseline.defaults.minSavingMs])
        assert.throws(() => baseline.withDecisionBaseline(value), /decision baseline/);
    const {store} = fixture(t);
    const before = store.load();
    const after = store.update(report(), {explicit:true, replace:true});
    assert.equal(after.decisionBaselineMs, baseline.decisionBaselineMs(after.baseline));
    assert.notEqual(after.decisionBaselineMs, before.decisionBaselineMs);
    assert.equal(require('../branching-baseline.json').checkpointDecisionBaselineMs, root.checkpointDecisionBaselineMs);
});
