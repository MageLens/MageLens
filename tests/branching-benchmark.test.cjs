// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test = require('node:test');
const assert = require('node:assert/strict');
const {matrix, renderSuite} = require('./performance/branching/matrix.cjs');
const {comparePair, summarize} = require('./performance/branching/analyze.cjs');

test('performance matrix includes profitable candidates and independent negative controls', () => {
    assert.ok(matrix.some(row => row.expected === 'branching'));
    assert.ok(matrix.some(row => row.disjoint));
    assert.ok(matrix.some(row => row.products === 1));
    assert.ok(new Set(matrix.map(row => row.consumers)).size >= 3);
    for (const row of matrix) {
        const suite = renderSuite(row);
        assert.equal((suite.match(/\btest\('/g) ?? []).length, row.consumers);
        assert.doesNotMatch(suite, /waitForTimeout|setTimeout|checkpointSelection|actionUnits|fixtureUnits/);
        assert.match(suite, /checkout-success/);
        assert.match(suite, /customer\/account\/login/);
    }
});

const arm = (branching = false) => ({status:'passed', tests:['a','b','c','d','e'], passed:5,
    setupMs:1000, testsMs:branching?7000:10000, totalMs:branching?8000:11000,
    phpDigest:'same', seedDigest:'seed', sourceDigest:'source', browser:'156.0.8078.80',
    checkpoints:branching?1:0, restores:branching?4:0, fallbacks:0, cleanup:true});
test('performance comparisons reject incomplete, mismatched or degraded runs', () => {
    const good=comparePair(arm(),arm(true));assert.ok(good.testsSpeedup>0.29);
    for (const patch of [{passed:4},{tests:['a']},{phpDigest:'different'},{seedDigest:'different'},
        {sourceDigest:'different'},{browser:'different'},{fallbacks:1},{cleanup:false},{status:'failed'}]) {
        assert.throws(()=>comparePair(arm(),{...arm(true),...patch}));
    }
    const result=summarize([{row:'positive',pair:1,...good},{row:'positive',pair:2,...good},{row:'positive',pair:3,...good}]);
    assert.equal(result.rows[0].samples,3);assert.equal(result.rows[0].allTestsFasterByTenPercent,true);
});

test('calibration uses matching successful source prefixes and never invents unmeasured reset costs', t => {
    const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
    const {calibrate}=require('./performance/branching/calibrate.cjs');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-calibration-'));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const put=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
    put('pairs.json',[{row:'shared',pair:1,...comparePair(arm(),arm(true))}]);
    const phase={status:'passed',counts:{fallbacks:0},checkpoints:[{}],releases:[{}],
        costs:{captures:[{ms:20}],restores:[{ms:10}],releases:[{ms:1}],resets:[50]},
        phases:{prepare:5,cleanup:6},checkpointPolicy:{selected:['shared']}};
    put('shared-1-branching/report.json',{phases:[{kind:'checkpoint',report:phase}]});
    put('shared-1-branching/manifest.json',{checkpoints:[{id:'shared',depth:2,consumers:['a','b']}],
        tests:['a','b'].map((id,index)=>({id,title:id,file:'journeys.spec.js',steps:[0,1].map(offset=>({
            line:3+index*3+offset,estimate:{complete:true,lowerBoundPoints:offset?20:10}}))}))});
    put('shared-1-linear/steps/all.json',['a','b'].flatMap((test,index)=>[0,1].map(offset=>({test,file:'journeys.spec.js',
        line:3+index*3+offset,ms:offset?250:150,failed:false}))));
    const result=calibrate([root]);
    assert.equal(result.prefixes.length,2);assert.equal(result.prefixes[0].points,30);
    assert.equal(result.prefixes[0].ms,400);assert.equal(result.measurements.backend.median,11);
    assert.equal(result.proposal.unitMs,10);assert.equal(result.proposal.resetMs,null);
    phase.counts.fallbacks=1;put('shared-1-branching/report.json',{phases:[{kind:'checkpoint',report:phase}]});
    assert.throws(()=>calibrate([root]));
});
