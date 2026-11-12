// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');

// Real planner transport for host integration tests, with only owned temporary
// files writable and no application services, network or database mounted.
function plannerFixture(t,prefix,{model}={}) {
    const repository=path.resolve(__dirname,'../../..');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
    const previous=process.env.MAGELENS_ORCHESTRATOR_CONTAINER;
    let container;
    t.after(()=>{
        if(previous===undefined)delete process.env.MAGELENS_ORCHESTRATOR_CONTAINER;
        else process.env.MAGELENS_ORCHESTRATOR_CONTAINER=previous;
        try {if(container)execFileSync('docker',['rm','--force',container],{stdio:'pipe'});}
        finally {fs.rmSync(root,{recursive:true,force:true});}
    });
    if([root,repository].some(value=>value.includes(',')))throw new Error('Planner fixture paths cannot contain commas');
    const image=execFileSync(path.join(repository,'bin/branching-image'),['orchestrator'],{
        cwd:repository,encoding:'utf8',stdio:['ignore','pipe','inherit']
    }).trim();
    const environment=[];
    if(model){const file=path.join(root,'model.json'),bytes=JSON.stringify(model);fs.writeFileSync(file,bytes,{mode:0o600});
        environment.push('--env',`MAGELENS_PREDICTOR_MODEL=${file}`,'--env',`MAGELENS_PREDICTOR_MODEL_SHA256=${require('node:crypto').createHash('sha256').update(bytes).digest('hex')}`);}
    container=execFileSync('docker',['run',...environment,'--detach','--rm','--init','--network','none',
        '--memory','512m','--memory-swap','512m','--user',`${process.getuid()}:${process.getgid()}`,
        '--mount',`type=bind,source=${repository},target=${repository},readonly`,
        '--mount',`type=bind,source=${root},target=${root}`,
        '--workdir',repository,'--entrypoint','sleep',image,'infinity'],{encoding:'utf8'}).trim();
    process.env.MAGELENS_ORCHESTRATOR_CONTAINER=container;
    return root;
}
module.exports={plannerFixture};
