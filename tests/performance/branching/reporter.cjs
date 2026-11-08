// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
function own(file) {
    const uid=Number(process.env.MAGELENS_HOST_UID),gid=Number(process.env.MAGELENS_HOST_GID);
    if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(file,uid,gid);
}
module.exports=class PerformanceReporter {
    constructor(){this.steps=[];}
    onTestBegin(test) {
        const marker={runId:process.env.MAGELENS_PERF_RUN,testId:test.id,firstTestStartedNs:process.hrtime.bigint().toString()};
        const file=process.env.MAGELENS_PERF_FIRST;
        if(!file)return;
        try {fs.writeFileSync(file,JSON.stringify(marker)+'\n',{flag:'wx',mode:0o600});own(file);}
        catch(error){if(error.code!=='EEXIST'||JSON.parse(fs.readFileSync(file)).runId!==marker.runId)throw error;}
    }
    onStepEnd(test,result,step) {
        if(!['pw:api','expect'].includes(step.category))return;
        for(let parent=step.parent;parent;parent=parent.parent)if(['pw:api','expect'].includes(parent.category))return;
        this.steps.push({test:test.titlePath().slice(3).join(' › '),file:test.location.file,line:step.location?.line,
            category:step.category,title:step.title,ms:step.duration,failed:!!step.error});
    }
    onEnd() {
        const directory=process.env.MAGELENS_PERF_STEPS;
        if(directory&&this.steps.length){fs.mkdirSync(directory,{recursive:true});own(directory);const file=path.join(directory,randomUUID()+'.json');fs.writeFileSync(file,JSON.stringify(this.steps)+'\n',{mode:0o600});own(file);}
    }
};
