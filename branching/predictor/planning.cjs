// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs'), path = require('node:path');
const predictor = require('./index.cjs');
const parser = require('@babel/parser');
const {executionContext}=require('./execution-context.cjs');
const MODEL_SHA256 = 'f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3';
const boundary = 'checkpoint-prefix/v1';

// Extract source, never import project code or run test registration callbacks.
function hooks(source, start, end) {
    const ast = parser.parse(source, {sourceType:'unambiguous', plugins:['typescript','jsx']});
    const result = [];
    function visit(node, scope = [0, source.length]) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const child of node) visit(child, scope); return; }
        if (['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration'].includes(node.type)) return;
        if (node.type === 'CallExpression') {
            const name = node.callee.name ?? node.callee.property?.name;
            const callback = node.arguments.findLast(n => ['ArrowFunctionExpression','FunctionExpression'].includes(n.type));
            if (callback && ['before','after','beforeEach','afterEach','beforeAll','afterAll'].includes(name) && start >= scope[0] && end <= scope[1])
                result.push({kind:name, scope, source:`const hook = ${source.slice(callback.start,callback.end)};`});
            if (callback && ['describe','context'].includes(name)) {
                visit(callback.body, [callback.start,callback.end]); return;
            }
        }
        for (const [key,value] of Object.entries(node)) if (key !== 'loc' && value && typeof value === 'object') visit(value,scope);
    }
    visit(ast); return result;
}
function assess(manifest, options = {}) {
    const loaded = options.loaded ?? predictor.loadModel(options.model ?? '/opt/magelens/predictor/model.json', options.modelDigest ?? MODEL_SHA256);
    const baselineMs = options.baselineMs ?? require('../../branching-baseline.json').checkpointDecisionBaselineMs;
    const sources = new Map();
    for (const entry of manifest.sources) {
        const file = path.resolve(manifest.root,entry.path);
        if (!file.startsWith(path.resolve(manifest.root)+path.sep) || fs.realpathSync(file)!==file) throw Error('Source escapes manifest root');
        const bytes = fs.readFileSync(file);
        if (predictor.sha256(bytes)!==entry.sha256) throw Error(`Source changed: ${entry.path}`);
        sources.set(entry.path,bytes);
    }
    const source = file => sources.get(file)?.toString('utf8');
    const fragment = (file,start,end) => sources.get(file).subarray(start,end).toString('utf8');
    const specs = new Set(manifest.tests.map(t=>t.file));
    const supporting = [...sources].filter(([file])=>!specs.has(file) && /\.[cm]?[jt]sx?$/.test(file))
        .map(([name,bytes])=>({name:`context/${name}`,source:bytes.toString('utf8'),role:'context'}));
    const contexts=new Map(manifest.tests.map(test=>[test.id,executionContext(manifest,sources,test)]));
    const supportHooks=new Map();
    const globalHooks=test=>contexts.get(test.id).support.flatMap(file=>{
        if(!supportHooks.has(file))supportHooks.set(file,hooks(source(file),0,source(file).length));
        return supportHooks.get(file).map(hook=>({...hook,file}));
    });
    const rows = {}, stages = {}, candidates = [], issues = manifest.diagnostics.map(message=>({phase:'collection',message}));
    function forecast(id, test, unit, work, timingBoundary) {
        const request = {runner:test.fixture.startsWith('cypress:')?'cypress':'playwright',unit,timingBoundary,
            sources:[...work,{name:`spec/${test.file}`,source:source(test.file),role:'context'},...supporting.filter(s=>contexts.get(test.id).files.has(s.name.slice(8)))],
            extraFeatures:unit==='test'?{'execution.first':Number(manifest.tests.find(t=>t.file===test.file)?.id===test.id),'execution.last':Number(manifest.tests.findLast(t=>t.file===test.file)?.id===test.id)}:{},
            baselineMs,manualMultiplier:options.multiplier ?? 1,sourceFamily:'branching',group:test.file,
            environment:{boundary:timingBoundary ?? 'playwright-test-result-duration/v1',collection:'source',platform:process.platform}};
        let snapshot;
        try {
            snapshot = predictor.prepare(request,loaded,{transfer:true});
        } catch(error) {snapshot={prediction:null,predictionError:error.toJSON?.() ?? {message:error.message}};}
        const result = {id,runner:request.runner,unit,...(timingBoundary?{timingBoundary}:{}),
            sourceDigest:snapshot.sourceDigest ?? null, input:{kind:'static-source',sources:request.sources.map(s=>({name:s.name,role:s.role,sha256:predictor.sha256(s.source)})),extraFeatures:request.extraFeatures}, prediction:snapshot.prediction, predictionError:snapshot.predictionError,
            warnings:snapshot.prediction ? [
                ...contexts.get(test.id).warnings,
                ...(!snapshot.prediction.qualified?['Model has not passed independent qualification']:[]),
                ...(!snapshot.prediction.domainMatched?['Forecast transfers the model to an unvalidated timing boundary']:[]),
                ...(snapshot.prediction.outOfRange?['Source features are outside the training range']:[])
            ] : []};
        if (!result.prediction) issues.push({phase:'predictor',id,unit,
            reasons:result.predictionError?.issues ?? [{message:'Missing ML prediction'}]});
        return result;
    }
    const fixtureWork = test => (test.fixtureSetup ?? (test.restoration?.fixtures ?? []).filter(f=>f.setup).map(f=>f.setup)).map((source,i)=>({name:`fixture-${i}.js`,source:`async function setup(){${source}}`,role:'work'}));
    const byId = new Map(manifest.tests.map(t=>[t.id,t]));
    for (const test of manifest.tests) {
        const bytes=sources.get(test.file), original=source(test.file);
        const start=bytes.subarray(0,test.callbackStart).toString('utf8').length;
        const end=bytes.subarray(0,test.callbackEnd).toString('utf8').length;
        const peers=manifest.tests.filter(t=>t.file===test.file);
        const work=[{name:'callback.js',source:`const work = ${fragment(test.file,test.callbackStart,test.callbackEnd)};`,role:'work'}];
        for (const [index,hook] of [...globalHooks(test),...hooks(original,start,end)].entries()) {
            const scoped=hook.file?peers:peers.filter(t=>{const pos=bytes.subarray(0,t.callbackStart).toString('utf8').length;return pos>=hook.scope[0]&&pos<=hook.scope[1];});
            const once=['before','beforeAll'].includes(hook.kind)?scoped[0]?.id===test.id:['after','afterAll'].includes(hook.kind)?scoped.at(-1)?.id===test.id:true;
            work.push({name:`hook-${index}.js`,source:hook.source,role:once?'work':'context'});
        }
        if (test.restoration) for (const frame of test.restoration.fixtures) if(frame.setup || frame.teardown)
            work.push({name:`fixture-${frame.name}.js`,source:`async function fixture(){${frame.setup ?? ''}\n${frame.teardown ?? ''}}`,role:'work'});
        if (!test.restoration) work.push(...fixtureWork(test));
        rows[test.id]=forecast(test.id,test,'test',work,test.fixture.startsWith('cypress:')?'cypress-test-duration-minus-preparation/v2':undefined);
        const rootId=`root-${test.scope.slice(0,20)}`;
        if (!stages[rootId]) {
            const frames=fixtureWork(test);
            stages[rootId]=frames.length?forecast(rootId,test,'prefix',frames,boundary)
                :{id:rootId,empty:true,prediction:{ms:0,modelId:loaded.id,qualified:loaded.model.qualified}};
        }
    }
    for (const cp of manifest.checkpoints) {
        const test=byId.get(cp.representative);
        const parent=manifest.checkpoints.filter(c=>c.depth<cp.depth&&c.consumers.includes(test.id)).sort((a,b)=>b.depth-a.depth)[0];
        const from=parent?.depth ?? 0;
        const work=cp.depth===0?fixtureWork(test):
            [{name:'prefix.js',source:`async function prefix(){\n${test.steps.slice(from,cp.depth).map(s=>fragment(test.file,s.start,s.end)).join('\n')}\n}`,role:'work'}];
        if(from===0 && cp.depth>0)work.unshift(...globalHooks(test).filter(h=>h.kind==='beforeEach').map((h,i)=>({name:`global-beforeEach-${i}.js`,source:h.source,role:'work'})));
        const result=work.length?forecast(cp.id,test,'prefix',work,boundary):{id:cp.id,prediction:null,predictionError:{message:'Missing fixture setup source'}};
        // Fixture cost belongs to the fixture checkpoint, never both it and its root.
        if(cp.depth===0) stages[`root-${test.scope.slice(0,20)}`]={id:`root-${test.scope.slice(0,20)}`,empty:true,prediction:{ms:0,modelId:loaded.id,qualified:loaded.model.qualified}};
        stages[cp.id]=result;
        candidates.push({id:cp.id,consumers:cp.consumers.length,automatic:cp.automatic,fromDepth:from,toDepth:cp.depth,
            estimatedSegmentMs:result.prediction?.ms ?? null,classification:result.prediction?'ml-estimated':'prediction-failed'});
    }
    return {...manifest,assessment:{version:'ml-duration-v1',modelId:loaded.id,modelQualified:loaded.model.qualified,
        baselineMs,manualMultiplier:options.multiplier ?? 1,status:issues.length?'incomplete':'complete',
        executionEligible:issues.length===0 && [...Object.values(rows),...Object.values(stages)].every(row=>row.empty || row.prediction?.executionEligible===true),
        analysis:manifest.assessment.analysis,tests:rows,stages,candidates,issues}};
}
module.exports={assess,MODEL_SHA256,boundary};
