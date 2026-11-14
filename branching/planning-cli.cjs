#!/usr/bin/env node
// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {assertAssessed,EstimationError,recordFailure,readManifest}=require('./estimation.cjs');
function writeJson(file,value) {
    const temporary=file+'.'+require('node:crypto').randomUUID()+'.tmp';
    try {
        fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
        fs.renameSync(temporary,file);
    } finally { fs.rmSync(temporary,{force:true}); }
}
function run(args=process.argv.slice(2)) {
    const [command,input,output,discoveryFile,...extra]=args;
    const binary=process.env.MAGELENS_SOURCE_BINARY ?? '/usr/local/bin/magelens-source';
    if (command === 'evaluate') throw Error('--evaluate was removed: plan shared prefixes and measure their first normal execution');
    for (const key of Object.keys(process.env))
        if (/^MAGELENS_(PREDICTOR_|PREFIX_(MODEL|TIMING|ENVIRONMENT|SOURCE))/.test(key) && process.env[key])
            throw Error(`${key} was removed: checkpoint reuse now measures first use; remove the ML configuration`);
    if(extra.length || discoveryFile && !['plan'].includes(command) || !['plan','verify'].includes(command) ||
        !input || (command==='verify'?output:!output))
        throw Error('Usage: magelens-plan plan SOURCE_ROOT MANIFEST [DISCOVERY_JSON] | verify MANIFEST');
    const saved=command==='verify'?readManifest(input):null;
    const root=fs.realpathSync(saved?.root ?? input), destination=path.resolve(output ?? input);
    const parent=path.dirname(destination);fs.mkdirSync(parent,{recursive:true});
    const realParent=fs.realpathSync(parent);
    if((realParent===root || realParent.startsWith(root+path.sep)) && !path.relative(root,realParent).split(path.sep).some(p=>p.startsWith('.')))
        throw Error('Write the manifest outside source or inside an ignored dot directory');
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'magelens-source-'));
    try {
        const scan=path.join(temp,'manifest.json');
        execFileSync(binary,['scan',root,scan],{maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
        const structure=JSON.parse(fs.readFileSync(scan));
        const evidence=discoveryFile ? JSON.parse(fs.readFileSync(discoveryFile,'utf8')) : saved?.assessment.discovery;
        if (evidence) {
            const ids=new Set(structure.tests.map(test=>test.id));
            const entries=evidence.tests;
            if (evidence.schemaVersion!==1 || typeof evidence.config!=='string' || !Array.isArray(entries) ||
                !entries.length || entries.some(entry=>!ids.has(entry?.staticId) || !entry.row) ||
                new Set(entries.map(entry=>entry.staticId)).size!==entries.length)
                throw Error('Invalid discovery evidence for this source inventory');

            if (evidence.dependencyRoots !== undefined) {
                if (!Array.isArray(evidence.dependencyRoots) || evidence.dependencyRoots.some(root=>typeof root!=='string' || !path.isAbsolute(root)))
                    throw Error('Invalid discovery dependency roots');

            }
            if (evidence.environment !== undefined) {
                if (!evidence.environment || Array.isArray(evidence.environment) || typeof evidence.environment!=='object')
                    throw Error('Invalid discovery environment');

            }
        }
        if (evidence) for (const {row} of evidence.tests)
            if (row.files) require('./discovery-context.cjs').discoveryContext(row, {root, dependencyRoots:evidence.dependencyRoots});
        const result=structure;
        if (evidence) result.assessment.discovery=evidence;
        if(command==='verify') {
            assertAssessed(result);
            if(JSON.stringify(saved)!==JSON.stringify(result)) throw new EstimationError([{phase:'verification',message:'Source or discovery changed; replan'}]);
            console.log('Manifest matches source and discovery');return result;
        }
        assertAssessed(result);
        writeJson(destination,result);
        fs.rmSync(destination+'.error.json',{force:true});
        console.log(`Shared-prefix plan: ${result.tests.length} tests, ${result.checkpoints.length} prefixes`);return result;
    } catch(error) {
        const failure=error instanceof EstimationError?error:new EstimationError([{phase:'planning',message:error.message}]);
        if(command==='plan')recordFailure(destination,failure);
        throw failure;
    } finally {fs.rmSync(temp,{recursive:true,force:true});}
}
module.exports={run};
if(require.main===module)try{run();}catch(error){console.error(JSON.stringify(error.toJSON?.() ?? {message:error.message}));process.exitCode=1;}
