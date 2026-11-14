#!/usr/bin/env node
// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {assess}=require('./planning.cjs');
const {assertAssessed,EstimationError,recordFailure,readManifest}=require('../estimation.cjs');
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
    if(command==='cost-plan' && !input) {
        process.stdout.write(execFileSync(binary,['cost-plan'],{input:fs.readFileSync(0)}));return;
    }
    if(extra.length || discoveryFile && !['plan','evaluate'].includes(command) || !['plan','evaluate','verify'].includes(command) ||
        !input || (command==='verify'?output:!output))
        throw Error('Usage: magelens-plan plan SOURCE_ROOT MANIFEST [DISCOVERY_JSON] | evaluate SOURCE_ROOT MANIFEST [DISCOVERY_JSON] | verify MANIFEST | cost-plan');
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
        const options={...(process.env.MAGELENS_PREDICTOR_MODEL?{model:process.env.MAGELENS_PREDICTOR_MODEL}:{}),
            ...(process.env.MAGELENS_PREFIX_TIMING_BOUNDARY ? {prefixTimingBoundary:process.env.MAGELENS_PREFIX_TIMING_BOUNDARY} : {}),
            ...(process.env.MAGELENS_PREFIX_SOURCE_STORE ? {sourceStore:process.env.MAGELENS_PREFIX_SOURCE_STORE} : {}),
            ...(process.env.MAGELENS_PREDICTOR_MODEL_SHA256?{modelDigest:process.env.MAGELENS_PREDICTOR_MODEL_SHA256}:{})};
        const prefixPath = process.env.MAGELENS_PREFIX_MODEL;
        const prefixDigest = process.env.MAGELENS_PREFIX_MODEL_SHA256;
        if (prefixPath || prefixDigest) {
            if (!prefixPath || !/^[a-f0-9]{64}$/.test(prefixDigest ?? ''))
                throw Error('A separate prefix model requires a SHA-256 pin');
            options.prefixLoaded = require('./index.cjs').loadModel(prefixPath, prefixDigest);
        }
        const backendState = process.env.MAGELENS_PREDICTOR_BACKEND_STATE;
        if (backendState) options.backendState = JSON.parse(backendState);
        if (process.env.MAGELENS_PREFIX_ENVIRONMENT)
            options.prefixEnvironment = JSON.parse(process.env.MAGELENS_PREFIX_ENVIRONMENT);
        const evidence=discoveryFile ? JSON.parse(fs.readFileSync(discoveryFile,'utf8')) : saved?.assessment.discovery;
        if (evidence) {
            const ids=new Set(structure.tests.map(test=>test.id));
            const entries=evidence.tests;
            if (evidence.schemaVersion!==1 || typeof evidence.config!=='string' || !Array.isArray(entries) ||
                !entries.length || entries.some(entry=>!ids.has(entry?.staticId) || !entry.row) ||
                new Set(entries.map(entry=>entry.staticId)).size!==entries.length)
                throw Error('Invalid discovery evidence for this source inventory');
            options.discoveryConfig=evidence.config;
            options.discoveryByTest=new Map(entries.map(entry=>[entry.staticId,entry.row]));
            if (evidence.dependencyRoots !== undefined) {
                if (!Array.isArray(evidence.dependencyRoots) || evidence.dependencyRoots.some(root=>typeof root!=='string' || !path.isAbsolute(root)))
                    throw Error('Invalid discovery dependency roots');
                options.discoveryDependencyRoots=evidence.dependencyRoots;
            }
            if (evidence.environment !== undefined) {
                if (!evidence.environment || Array.isArray(evidence.environment) || typeof evidence.environment!=='object')
                    throw Error('Invalid discovery environment');
                options.environment=evidence.environment;
            }
        }
        const result=assess(structure,options);
        if (evidence) result.assessment.discovery=evidence;
        if(command==='verify') {
            assertAssessed(result);
            for (const [id,stage] of Object.entries(result.assessment.stages)) {
                const previous = saved.assessment.stages[id]?.trainingSnapshot;
                if (previous && stage.trainingSnapshot) {
                    stage.trainingSnapshot.observationId = previous.observationId;
                    stage.trainingSnapshot.capturedAt = previous.capturedAt;
                }
            }
            if(JSON.stringify(saved)!==JSON.stringify(result)) throw new EstimationError([{phase:'verification',message:'Source, model or assessment changed; replan'}]);
            console.log('Manifest matches source and ML model');return result;
        }
        // Evaluation is always retained separately; it never revives an executable plan.
        writeJson(destination+'.assessment.json',result);
        if(command==='evaluate') {
            console.log(JSON.stringify({status:result.assessment.status,modelId:result.assessment.modelId,tests:result.tests.length,
                prefixes:result.checkpoints.length,report:destination+'.assessment.json'}));return result;
        }
        assertAssessed(result);
        writeJson(destination,result);
        fs.rmSync(destination+'.error.json',{force:true});
        console.log(`ML plan: ${result.tests.length} tests, ${result.checkpoints.length} prefixes`);return result;
    } catch(error) {
        const failure=error instanceof EstimationError?error:new EstimationError([{phase:'planning',message:error.message}]);
        if(command==='plan')recordFailure(destination,failure);
        throw failure;
    } finally {fs.rmSync(temp,{recursive:true,force:true});}
}
module.exports={run};
if(require.main===module)try{run();}catch(error){console.error(JSON.stringify(error.toJSON?.() ?? {message:error.message}));process.exitCode=1;}
