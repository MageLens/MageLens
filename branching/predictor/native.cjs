// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs'), path = require('node:path');
const p = require('./index.cjs');
const {EstimationError} = require('../estimation.cjs');
function collector(profile, directory, root) {
    const model = profile.model ? p.loadModel(profile.model,profile.modelDigest) : null;
    const file = path.join(directory,'predictions.json');
    return batch => {
        const preparationStarted = performance.now();
        const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
        const firstRow = rows.length;
        const original = fs.readFileSync(batch.file,'utf8'), fileHash=p.sha256(original);
        const context=[...new Set([...(profile.files ?? []),...(batch.files ?? [])].map(file=>path.resolve(root,file)))].sort().filter(file=>file!==batch.file)
            .map(file=>({file,source:fs.readFileSync(file,'utf8')}));
        const files=[{file:batch.file,hash:fileHash},...context.map(item=>({file:item.file,hash:p.sha256(item.source)}))];
        const scopedTests = new Map(batch.hooks.map(hook => [hook, batch.tests.filter(test =>
            test.expectedStatus !== 'skipped' && hook.scope.every((title,i) => test.titlePath[i] === title))]));
        for (const [index,test] of batch.tests.entries()) {
            if (test.expectedStatus === 'skipped') continue;
            const hooks = batch.hooks.filter(h => h.scope.every((title,i) => test.titlePath[i] === title));
            const sources = [{name:'callback.js',source:test.timingSource,role:'work'},{name:'spec.js',source:original,role:'context'},
                ...hooks.map((h,i)=>({name:`hook-${i}.js`,source:h.source,
                    role: (h.kind === 'before' && scopedTests.get(h)[0]?.id !== test.id) ||
                        (h.kind === 'after' && scopedTests.get(h).at(-1)?.id !== test.id) ? 'context' : 'work'})),
                ...(test.timingSources ?? []),
                ...context.map((item,i)=>({name:`context-${i}.js`,source:item.source,role:'context'}))];
            const runner=profile.runner ?? 'cypress';
            const snapshot=p.prepare({runner,unit:'test',sources,sourceStore:profile.sourceStore,
                ...(runner==='cypress'?{timingBoundary:'cypress-test-duration-minus-preparation/v2'}:{}),
                sourceFamily:profile.sourceFamily,group:profile.group ?? path.relative(root,batch.file).replaceAll(path.sep,'/'),
                environment:{...profile.environment,hookAttribution:'scoped-once/v1',...(batch.lifecycle?{lifecycle:batch.lifecycle}:{}),
                    boundary:runner==='cypress'?'cypress-test-duration-minus-preparation/v2':'playwright-test-result-duration/v1'},
                baselineMs:profile.baselineMs,manualMultiplier:profile.multiplier ?? 1,
                extraFeatures:{...profile.extraFeatures,'execution.first':Number(index===0),'execution.last':Number(index===batch.tests.length-1)}},model);
            rows.push({id:test.id,file:batch.file,fileHash,files,snapshot});
        }
        // Cypress attributes this root before hook to the first runnable test.
        // Record the measured collector work separately; never estimate or
        // retrospectively subtract overhead from older observations.
        if ((profile.runner ?? 'cypress') === 'cypress' && rows[firstRow])
            rows[firstRow].preparationMs = performance.now() - preparationStarted;
        fs.writeFileSync(file,JSON.stringify(rows)+'\n',{mode:0o600});
        return null;
    };
}
function sourceAt(file, line, column) {
    const source=fs.readFileSync(file,'utf8');
    let ast;
    try { ast=require('@babel/parser').parse(source,{sourceType:'unambiguous',plugins:['typescript','jsx']}); }
    catch(error) { throw new EstimationError([{phase:'predictor',message:`Cannot parse source ${file}: ${error.message}`}]); }
    const pending=[ast];
    while(pending.length) {
        const node=pending.pop();
        if(!node || typeof node!=='object')continue;
        if(Array.isArray(node)){pending.push(...node);continue;}
        if(node.type==='CallExpression' && node.loc.start.line===line && node.loc.start.column===column-1) {
            const callback=node.arguments.findLast(arg=>['ArrowFunctionExpression','FunctionExpression'].includes(arg.type));
            if(callback)return `const work = ${source.slice(callback.start,callback.end)};`;
        }
        for(const [key,value] of Object.entries(node))if(key!=='loc' && value && typeof value==='object')pending.push(value);
    }
    throw new EstimationError([{phase:'predictor',message:`No test callback at ${file}:${line}:${column}; provide a source location for generated tests`}]);
}
function finish(directory, report) {
    const file=path.join(directory,'predictions.json');
    if (!fs.existsSync(file)) throw new Error('Missing pre-run test predictions');
    const rows=JSON.parse(fs.readFileSync(file)).map(row=>{
        const result=report.results.find(r=>r.id===row.id);
        if (!result || !(result.durationMs>0)) return {...row.snapshot,eligible:false,exclusion:'Missing or invalid native result',actualMs:null};
        const unchanged=(row.files ?? [{file:row.file,hash:row.fileHash}]).every(item=>
            fs.existsSync(item.file) && p.sha256(fs.readFileSync(item.file))===item.hash);
        const preparationMs = row.preparationMs ?? 0;
        const actualMs = result.durationMs - preparationMs;
        if (!Number.isFinite(preparationMs) || preparationMs < 0 || !(actualMs > 0))
            throw new EstimationError([{phase:'predictor',message:'Invalid measured preparation overhead'}]);
        return {...p.observe(row.snapshot,actualMs,{passed:result.status==='passed' && !result.errors.length,
            attempts:result.attempts,sourceDigest:unchanged?row.snapshot.sourceDigest:'changed'}),
            timing:{nativeMs:result.durationMs,preparationMs}};
    });
    fs.writeFileSync(path.join(directory,'prediction-samples.json'),JSON.stringify(rows)+'\n',{mode:0o600});
    return p.evaluate(rows);
}
module.exports={collector,finish,sourceAt};
