// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs'),path=require('node:path');
const {openProject}=require('./baseline.cjs');
const {loadRunner}=require('./runners/index.cjs');
const {RetainedMagentoBackend}=require('./retained-magento.cjs');
const leases=require('./workflow-lease.cjs');
const {probe}=require('./storage.cjs');
async function run(args=process.argv.slice(2)) {
    if(args.length!==3)throw new Error('Expected MANIFEST.json CONFIG.cjs COW_STORAGE');
    const [manifestFile,configuration,storage]=args;
    const manifest=JSON.parse(fs.readFileSync(manifestFile));
    require('./automatic.cjs').verifySources(manifest);
    const supplied=require(path.resolve(configuration));
    const project=typeof supplied==='function'?await supplied(manifest):supplied;
    require('./costs.cjs').assertAutomatic(project);
    probe(storage);
    const workspace=process.cwd(),workflowLease=leases.acquire(workspace);
    let runtime,report;
    try {
        const store=openProject(workspace,project.baseline),used=store.load();
        runtime=await loadRunner(process.env.MAGELENS_RUNNER??'playwright').open(process.env,project.runnerOptions);
        if(typeof runtime.calibrate!=='function')throw new Error('This runner does not support checkpoint calibration');
        const backend=new RetainedMagentoBackend({workspace,helperImage:process.env.MAGELENS_BRANCHING_IMAGE,disposable:true,workflowLease});
        report=await runtime.calibrate({backend,root:storage,samples:3});
        report.baseline={used,update:store.update(report,{explicit:true,replace:true})};
        const directory=path.join(workspace,'.runtime/branching-results');fs.mkdirSync(directory,{recursive:true});
        const file=path.join(directory,'calibration-'+report.run+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
        const uid=Number(process.env.MAGELENS_HOST_UID),gid=Number(process.env.MAGELENS_HOST_GID);
        if(Number.isInteger(uid)&&Number.isInteger(gid)){fs.chownSync(directory,uid,gid);fs.chownSync(file,uid,gid);}
        console.log(`${report.status}: checkpoint calibration (${report.costs.captures.length} captures, ${report.costs.restores.length} restores)`);
        if(report.baseline.update.updated)console.log(`Checkpoint decision baseline: ${report.baseline.update.decisionBaselineMs.toFixed(1)} ms (two-test break-even)`);
        console.log(`Report: ${file}`);
        for(const regression of report.baseline.update.regressions??[])
            console.warn(`Checkpoint overhead increased: ${regression.metric} ${regression.referenceMs.toFixed(1)} → ${regression.observedMs.toFixed(1)} ms`);
        for(const error of report.errors)console.error(`${error.phase}: ${error.message}`);
        if(report.status!=='passed')process.exitCode=1;
        return report;
    } finally {
        try {await runtime?.close();}
        finally {if(!leases.release(workflowLease)){console.error('Calibration workflow lock retained for recovery');process.exitCode=1;}}
    }
}
if(require.main===module)run().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={run};
