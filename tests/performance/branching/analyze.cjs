// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert=require('node:assert/strict');
const median=values=>{const a=[...values].sort((x,y)=>x-y);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
function comparePair(linear,branching) {
    for(const arm of [linear,branching]) {
        assert.equal(arm.status,'passed'); assert.equal(arm.passed,arm.tests.length);
        assert.equal(new Set(arm.tests).size,arm.tests.length); assert.ok(arm.tests.length);
        assert.equal(arm.fallbacks,0); assert.equal(arm.cleanup,true);
        for(const event of ['oom','oom_kill']) assert.equal(arm.resources?.driverMemoryEvents?.[event]??0,0,'Driver memory pressure invalidates the sample');
        for(const key of ['setupMs','testsMs','totalMs']) assert.ok(Number.isFinite(arm[key])&&arm[key]>0);
        assert.ok(Math.abs(arm.setupMs+arm.testsMs-arm.totalMs)<0.01);
    }
    assert.deepEqual([...linear.tests].sort(),[...branching.tests].sort());
    assert.equal(linear.resources?.driverMemoryLimitBytes,branching.resources?.driverMemoryLimitBytes,'Driver memory limits differ');
    for(const key of ['phpDigest','seedDigest','sourceDigest','browser']) {assert.ok(linear[key]);assert.equal(linear[key],branching[key],key);}
    assert.equal(linear.checkpoints,0); assert.equal(linear.restores,0);
    if(branching.checkpoints) assert.ok(branching.restores>0,'Selected checkpoints must actually be reused');
    return {linear,branching,setupDifferenceMs:branching.setupMs-linear.setupMs,
        testsSpeedup:1-branching.testsMs/linear.testsMs,totalSpeedup:1-branching.totalMs/linear.totalMs};
}
function summarize(pairs) {
    const rows=[...new Set(pairs.map(p=>p.row))].map(row=>{
        const samples=pairs.filter(p=>p.row===row);
        return {row,samples:samples.length,medianSetupDifferenceMs:median(samples.map(p=>p.setupDifferenceMs)),
            medianTestsSpeedup:median(samples.map(p=>p.testsSpeedup)),medianTotalSpeedup:median(samples.map(p=>p.totalSpeedup)),
            minTestsSpeedup:Math.min(...samples.map(p=>p.testsSpeedup)),maxTestsSpeedup:Math.max(...samples.map(p=>p.testsSpeedup)),
            actualCheckpoints:samples.map(p=>p.branching.checkpoints),actualRestores:samples.map(p=>p.branching.restores),
            estimatedCheckpoints:samples.map(p=>p.branching.estimatedCheckpoints??null),
            executionReasons:[...new Set(samples.map(p=>p.branching.selectionReason).filter(Boolean))],
            overheadRegressions:samples.flatMap(p=>p.branching.baseline?.update?.regressions??[]),
            allTestsFasterByTenPercent:samples.length>=3&&samples.every(p=>p.testsSpeedup>=0.10&&p.branching.restores>0)};
    });
    return {schemaVersion:1,rows,calibrationPolicy:'Default costs are versioned configuration. Successful runs update project operation averages only after completion; the baseline is fixed during each run.'};
}
if(require.main===module) {const fs=require('node:fs');const input=JSON.parse(fs.readFileSync(process.argv[2]));console.log(JSON.stringify(summarize(input),null,2));}
module.exports={comparePair,summarize,median};
