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

test('fixture matrix covers automatic restoration, sibling isolation and per-test teardown', () => {
    const rows=matrix.filter(row=>row.fixture);
    assert.equal(rows.length,3);
    assert.deepEqual(new Set(rows.map(row=>row.expectedCost)),new Set(['linear','branching']));
    for(const row of rows) {
        assert.equal(row.expected,row.expectedCost);
        const source=renderSuite(row);
        assert.match(source,/base\.extend/);
        assert.match(source,/await prepareCheckout\(page\)/);
        assert.match(source,/if \(await page\.locator\(.+\)\.count\(\) === 0\)/);
        assert.equal((source.match(/async \(\{page,(?:checkoutState,)?checkoutReady\}\)/g)??[]).length,row.consumers);
        assert.equal((source.match(/function prepareCheckout/g)??[]).length,1);
        assert.doesNotMatch(source,/adapter|actionUnits|fixtureUnits|checkpointSelection/);
        if(row.products===80) {
            const single=renderSuite({...row,consumers:1});
            assert.equal((single.match(/toHaveText\("\$1,042\.00"\)/g)??[]).length,2,'Both checkout and saved-order totals retain their exact formatted amount');
            assert.doesNotMatch(source,/\$1042\.00/);
        }
    }
});

test('Rust assesses the reusable fixture rows with approximate costs and the matrix checkpoint cap', t => {
    const fs=require('node:fs'),path=require('node:path');
    const {planner}=require('../branching/planner-client.cjs');
    const {assess}=require('./performance/branching/plan.cjs');
    const directory=require('./fixtures/branching/planner.cjs').plannerFixture(t,'magelens-fixture-matrix-');
    for(const row of matrix.filter(row=>row.fixture)) {
        const root=path.join(directory,row.id);fs.mkdirSync(root);
        fs.writeFileSync(path.join(root,'journeys.spec.ts'),renderSuite(row));
        const output=path.join(directory,row.id+'.json');
        planner(['plan',root,output],{stdio:'pipe'});
        const manifest=JSON.parse(fs.readFileSync(output));
        const result=assess(manifest,4);
        assert.equal(result.decision.maxCheckpointsPerTest,4);
        assert.equal(result.decision.selected.length>0,row.expectedCost==='branching',row.id);
        assert.notEqual(result.execution?.eligible,false);
        assert.ok(manifest.tests.every(test=>test.restoration?.version===1&&test.disposition==='automatic'));
        assert.equal(manifest.tests.length,row.consumers);
        assert.ok(manifest.tests.every(test=>test.fixtureEstimate.estimatedPoints>test.fixtureEstimate.lowerBoundPoints));
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

test('performance comparisons reject driver OOM events and unequal memory limits', () => {
    const resources={driverMemoryLimitBytes:3*1024**3,driverMemoryEvents:{oom:0,oom_kill:0}};
    const linear={...arm(),resources},branching={...arm(true),resources};
    assert.ok(comparePair(linear,branching).testsSpeedup>0);
    for(const patch of [{driverMemoryLimitBytes:2*1024**3},
        {driverMemoryEvents:{oom:1,oom_kill:0}},{driverMemoryEvents:{oom:1,oom_kill:1}}]) {
        assert.throws(()=>comparePair(linear,{...branching,resources:{...resources,...patch}}));
    }
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
