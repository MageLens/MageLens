// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {runSuite}=require('../../../branching/suite.cjs');
const native=require('../../../branching/runners/playwright/native.cjs');
const {main}=require('../../../branching/cli.cjs');
const leases=require('../../../branching/workflow-lease.cjs');
(async()=>{
    const [arm,suite,output,manifestFile,storage]=process.argv.slice(2);
    assert.ok(['linear','branching'].includes(arm));
    const directory=path.join(output,'native');let report;
    if(arm==='linear')report=await native.run(path.join(suite,'playwright.config.cjs'),directory);
    else {
        const manifest=JSON.parse(fs.readFileSync(manifestFile));
        const project=require('./config.cjs').project(manifest);
        if(process.env.MAGELENS_PERFORMANCE_FREEZE_BASELINE==='1')project.baseline={updateOnSuccess:false};
        const workflowLease=leases.acquire(process.cwd());
        try {
            const store=require('../../../branching/baseline.cjs').openProject(process.cwd(),project.baseline);
            const used=store.load();project.costBaseline=used.baseline;
            report=await runSuite({manifest,project,directory,runner:native,
                runCheckpoint:configuration=>main({...configuration,workflowLease},storage)});
            report.baseline={used,update:store.update(report)};
        }
        finally {assert.ok(leases.release(workflowLease),'Recovery is required before another run');}
    }
    const peak='/sys/fs/cgroup/memory.peak';
    report.benchmarkResources={driverCgroupPeakBytes:fs.existsSync(peak)?Number(fs.readFileSync(peak,'utf8').trim()):null,
        nodePeakRssBytes:process.resourceUsage().maxRSS*1024};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    const uid=Number(process.env.MAGELENS_HOST_UID),gid=Number(process.env.MAGELENS_HOST_GID);
    if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(path.join(output,'report.json'),uid,gid);
    assert.equal(report.status,'passed');
    assert.ok(report.results.every(result=>result.status==='passed'));
    console.log(JSON.stringify({status:report.status,results:report.results.length,checkpoints:report.checkpoints??0,reuses:report.reuseHits??0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
