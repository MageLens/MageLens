// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {RetainedMagentoBackend}=require('../branching/retained-magento.cjs');
const {withRuntimeState}=require('../branching/runtime-state.cjs');
function temporary(t) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-control-'));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;
}
test('retained control pins service IDs, detects replacement and invalidates IDs after recreation',t=>{
    const root=temporary(t),bin=path.join(root,'bin'),first='1'.repeat(64),second='2'.repeat(64);
    fs.mkdirSync(bin);fs.writeFileSync(path.join(root,'id'),first+'\n');
    fs.writeFileSync(path.join(bin,'common'),`dc() { printf '%s\\n' "$*" >> "$PWD/compose.log"; if [ "$1" = ps ]; then cat "$PWD/id"; fi; }\n`);
    fs.writeFileSync(path.join(bin,'docker'),'#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$PWD/docker.log"\n',{mode:0o755});
    const before=process.env.PATH;process.env.PATH=bin+path.delimiter+before;t.after(()=>{process.env.PATH=before;});
    const backend=new RetainedMagentoBackend({workspace:root,disposable:true});backend.warmReady=true;
    backend.dc(['exec','-T','phpfpm','php','probe.php']);backend.dc(['exec','-T','phpfpm','php','probe.php']);
    assert.equal(fs.readFileSync(path.join(root,'compose.log'),'utf8').trim(),'ps -a -q phpfpm');
    assert.equal(fs.readFileSync(path.join(root,'docker.log'),'utf8').trim().split('\n').length,2);
    fs.writeFileSync(path.join(root,'id'),second+'\n');
    assert.throws(()=>backend.dc(['ps','-q']),/replaced/);
    backend.dc(['up','-d','phpfpm']);backend.dc(['exec','-T','phpfpm','php','probe.php']);
    assert.ok(fs.readFileSync(path.join(root,'docker.log'),'utf8').includes(second));
    backend.dc(['exec','-T','phpfpm','php','probe.php'],true);
    assert.match(fs.readFileSync(path.join(root,'compose.log'),'utf8'),/exec -T phpfpm php probe.php/);
});
test('fixture restoration preserves early preparation options and restores runner state afterwards',async t=>{
    const root=temporary(t);fs.writeFileSync(path.join(root,'runner-state.json'),'{}');
    const options={prefetch:{directory:root,next:'next'}},events=[];
    const provider={restore:async(directory,actual)=>{assert.equal(directory,root);assert.equal(actual,options);events.push('backend');}};
    const state={restore:async()=>events.push('fixtures')};
    await withRuntimeState(provider,state).restore(root,options);
    assert.deepEqual(events,['backend','fixtures']);
});
