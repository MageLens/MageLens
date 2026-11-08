// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {CheckpointStore}=require('./checkpoint-store.cjs');
const {cleanup,write}=require('./checkpoint-files.cjs');
const {digest}=require('./identity.cjs');
const config=require('./configs/runtime.cjs');

// Project setup operation: exercise the provider and store without executing or
// forcing any user test. Ordinary test execution remains AUTO-only.
async function measure({provider,root,samples=3,warmup}) {
    assert.ok(Number.isInteger(samples)&&samples>=1&&samples<=9,'Calibration requires 1–9 samples');
    assert.equal(typeof warmup,'function');
    const run=randomUUID();fs.mkdirSync(root,{recursive:true});
    const directory=fs.mkdtempSync(path.join(root,config.files.runPrefix));
    write(path.join(directory,config.files.owner),{schemaVersion:1,kind:config.checkpoint.ownerKind,run});
    const report={schemaVersion:1,kind:'baseline-calibration',run,directory,status:'failed',errors:[],phases:{},
        counts:{fallbacks:0,failures:0,blockedSpecs:0},checkpoints:[],releases:[],
        costs:{captures:[],restores:[],releases:[],resets:[]}};
    const start=performance.now();
    async function measured(name,action) {
        const start=performance.now();try{return await action();}
        finally {report.phases[name]=(report.phases[name]??0)+performance.now()-start;}
    }
    const store=new CheckpointStore(directory,run,digest(provider.identity));
    let cleaned=false;
    try {
        await measured('prepare',()=>provider.prepare({run,directory,approach:'branching'}));
        for(let index=0;index<samples;index++) {
            let time=performance.now();await measured('reset',()=>provider.reset());report.costs.resets.push(performance.now()-time);
            await measured('warmup',()=>warmup(provider));
            const expected=digest(await provider.normalizedState());
            const stage='calibration-'+index,key=digest({stage,profile:provider.identity});
            time=performance.now();
            const ref=await store.capture({key,stage,parent:null,lineage:[],ttlMs:config.checkpoint.ttlMs,provider,measured,
                assert:async p=>assert.equal(digest(await p.normalizedState()),expected,'Calibration state changed')});
            const manifest=store.verify(ref,key);report.costs.captures.push({stage,ms:performance.now()-time});report.checkpoints.push(manifest);
            time=performance.now();
            store.verify(ref,key);
            await measured('restore',()=>provider.restore(path.join(ref.directory,config.files.payload)));
            assert.equal(digest(await provider.normalizedState()),expected,'Calibration restoration changed application state');
            report.costs.restores.push({stage,ms:performance.now()-time});
            time=performance.now();const checkpoint=store.release(stage);
            report.costs.releases.push({stage,ms:performance.now()-time});report.releases.push({stage,checkpoint});
        }
    } catch(error) {report.errors.push({phase:'calibration',message:error.message});}
    finally {
        try {await measured('cleanup',()=>provider.cleanup());cleaned=true;}
        catch(error){report.errors.push({phase:'cleanup',message:error.message});}
        report.providerDiagnostics=provider.diagnostics;
        if(cleaned)try {await measured('cleanup',async()=>cleanup(directory,run));}
        catch(error){report.errors.push({phase:'cleanup',message:error.message});}
    }
    report.wallMs=performance.now()-start;
    if(!report.errors.length&&report.costs.restores.length===samples&&!fs.existsSync(directory))report.status='passed';
    return report;
}
module.exports={measure};
