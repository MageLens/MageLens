// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {TEST_TIMING_BOUNDARY,PLAYWRIGHT_TEST_TIMING_BOUNDARY,PREFIX_TIMING_BOUNDARY,SEGMENT_TIMING_BOUNDARY} = require('./prefix-measurement.cjs');
const fs = require('node:fs'), path = require('node:path');
const predictor = require('./index.cjs');
const parser = require('@babel/parser');
const {executionContext}=require('./execution-context.cjs');
const {representWorkload, summarizeWorkloadRepresentations} = require('./workload-representation.cjs');
const MODEL_SHA256 = 'f5621bb710749ca616117ef979b0a039c12680dee08f79a1cce46cde3413a8c3';
const boundary = PREFIX_TIMING_BOUNDARY;

// Extract source, never import project code or run test registration callbacks.
function hooks(source) {
    const ast = parser.parse(source, {sourceType:'unambiguous', plugins:['typescript','jsx']});
    const result = [];
    function visit(node, scope = [0, source.length], expanded = false) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const child of node) visit(child, scope, expanded); return; }
        if (['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration'].includes(node.type)) return;
        if (node.type === 'CallExpression') {
            const name = node.callee.name ?? node.callee.property?.name;
            const callback = node.arguments.findLast(n => ['ArrowFunctionExpression','FunctionExpression'].includes(n.type));
            // The Rust planner already expanded the registration table.
            // Recover suite hooks from the same lexical callback body.
            if (callback && name === 'forEach' && node.callee.object?.type === 'ArrayExpression') {
                visit(callback.body, scope, true); return;
            }
            if (callback && ['before','after','beforeEach','afterEach','beforeAll','afterAll'].includes(name))
                result.push({kind:name, scope, expanded, start:callback.start, end:callback.end, source:`const hook = ${source.slice(callback.start,callback.end)};`});
            if (callback && ['describe','context'].includes(name)) {
                visit(callback.body, [callback.start,callback.end], expanded); return;
            }
        }
        for (const [key,value] of Object.entries(node)) if (key !== 'loc' && value && typeof value === 'object') visit(value,scope,expanded);
    }
    visit(ast); return result;
}
function assess(manifest, options = {}) {
    if (options.prefixEnvironment !== undefined && (!options.prefixEnvironment ||
        Array.isArray(options.prefixEnvironment) || typeof options.prefixEnvironment !== 'object'))
        throw new Error('Invalid prefix environment');
    const loaded = options.loaded ?? predictor.loadModel(options.model ?? '/opt/magelens/predictor/model.json', options.modelDigest ?? MODEL_SHA256);
    const prefixModel = options.prefixLoaded ?? loaded;
    const prefixBoundary = options.prefixTimingBoundary ?? boundary;
    if (![boundary,SEGMENT_TIMING_BOUNDARY].includes(prefixBoundary)) throw new Error('Unsupported prefix timing boundary');
    const baselineMs = options.baselineMs ?? loaded.model.referenceBaselineMs;
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
    const configSelections = new Map();
    const conditionalImports = new Map();
    // Provider origins are fixed for this assessment. Reuse boundary extraction
    // for shared context objects while retaining each forecast's own summary.
    const workloadBoundaries = new Map();
    const contexts=new Map(manifest.tests.map(test=>[test.id,executionContext(manifest,sources,test,configSelections,conditionalImports)]));
    const discoveredContext = new Map();
    function testContext(test) {
        const context = supporting.filter(s=>contexts.get(test.id).files.has(s.name.slice(8)));
        const row = options.discoveryByTest?.get(test.id);
        if (!row?.files) return context;
        if (!discoveredContext.has(test.id)) {
            const verified = require('./discovery-context.cjs').discoveryContext(row,
                {root:manifest.root,dependencyRoots:options.discoveryDependencyRoots});
            const combined = new Map(context.map(s=>[s.name,s]));
            for (const item of verified) {
                const existing = combined.get(item.name);
                if (existing && existing.source !== item.source) throw Error('Discovery context conflicts with planner source');
                combined.set(item.name,item);
            }
            discoveredContext.set(test.id,[...combined.values()]);
        }
        return discoveredContext.get(test.id);
    }
    const supportHooks=new Map();
    const specHooks=new Map();
    const globalHooks=test=>contexts.get(test.id).support.flatMap(file=>{
        if(!supportHooks.has(file))supportHooks.set(file,hooks(source(file))
            .filter(hook=>hook.scope[0]===0 && hook.scope[1]===source(file).length).map(hook=>({...hook,file})));
        return supportHooks.get(file);
    });
    const rows = {}, stages = {}, candidates = [], issues = manifest.diagnostics.map(message=>({phase:'collection',message}));
    const runnableByFile = new Map();
    for (const test of manifest.tests) {
        if ([predictor.REACHABLE_SCHEMA_V5,predictor.REACHABLE_SCHEMA_V6,predictor.REACHABLE_SCHEMA_V7].includes(loaded.model.featureSchema) && test.staticallySkipped) continue;
        if (!runnableByFile.has(test.file)) runnableByFile.set(test.file,[]);
        runnableByFile.get(test.file).push(test);
    }
    function forecast(id, test, unit, work, timingBoundary, discoveredFixtures = false, segment) {
        const model = unit === 'prefix' ? prefixModel : loaded;
        const request = {backendState:options.backendState,runner:test.fixture.startsWith('cypress:')?'cypress':'playwright',unit,timingBoundary,
            ...(segment ? {segment} : {}),
            sources:[...work,{name:`spec/${test.file}`,source:source(test.file),role:'context'},...(unit === 'test' ? testContext(test) : supporting.filter(s=>contexts.get(test.id).files.has(s.name.slice(8))))],
            extraFeatures:unit==='test'?{'execution.first':Number(runnableByFile.get(test.file)?.[0]?.id===test.id),'execution.last':Number(runnableByFile.get(test.file)?.at(-1)?.id===test.id)}:{},
            baselineMs:options.baselineMs ?? model.model.referenceBaselineMs,manualMultiplier:options.multiplier ?? 1,sourceFamily:'branching',group:test.file,
            environment:unit === 'test' && options.environment ? {...options.environment,
                ...(discoveredFixtures ? {hookAttribution:'scoped-once/v1',lifecycle:'playwright-loaded-fixtures/v1'} : {}),
                boundary:timingBoundary ?? PLAYWRIGHT_TEST_TIMING_BOUNDARY} :
                {...(unit === 'prefix' ? options.prefixEnvironment : {}),
                    boundary:timingBoundary ?? PLAYWRIGHT_TEST_TIMING_BOUNDARY,collection:'source',platform:process.platform},
            ...(unit === 'prefix' && timingBoundary === SEGMENT_TIMING_BOUNDARY && options.sourceStore ? {sourceStore:options.sourceStore} : {})};
        let snapshot;
        try {
            snapshot = predictor.prepare(request,model,{transfer:true});
        } catch(error) {snapshot={prediction:null,predictionError:error.toJSON?.() ?? {message:error.message}};}
        const discoveredSnapshot = unit === 'test' && options.discoveryByTest?.get(test.id)?.snapshot;
        if (options.environment && discoveredSnapshot?.environmentDigest &&
            snapshot.environmentDigest !== discoveredSnapshot.environmentDigest)
            throw Error('Discovery environment does not match planner environment');
        const workload = representWorkload(work, {timingBoundary, runner: request.runner, ...options.providerOrigins},workloadBoundaries);
        const result = {id,runner:request.runner,unit,featureSchema:snapshot.featureSchema ?? null,environmentDigest:snapshot.environmentDigest ?? null,...(timingBoundary?{timingBoundary}:{}),
            sourceDigest:snapshot.sourceDigest ?? null, input:{kind:'static-source',featureSchema:snapshot.featureSchema ?? null,extracted:Boolean(snapshot.vector),sources:request.sources.map(s=>({name:s.name,role:s.role,sha256:predictor.sha256(s.source),...(s.origin ? {origin:s.origin} : {})})),selectedImplementations:snapshot.selectedImplementations??[],unresolvedEdges:snapshot.unresolvedEdges??[],extraFeatures:request.extraFeatures,...(snapshot.backendState ? {backendState:snapshot.backendState} : {})}, prediction:snapshot.prediction, predictionError:snapshot.predictionError,
            workload,
            warnings:snapshot.prediction ? [
                ...contexts.get(test.id).warnings,
                ...(test.opaqueFixtureProvider && !discoveredFixtures ? ['Playwright fixture provider requires native lifecycle inputs'] : []),
                ...(!snapshot.prediction.qualified?['Model has not passed independent qualification']:[]),
                ...(!snapshot.prediction.domainMatched?['Forecast transfers the model to an unvalidated timing boundary']:[]),
                ...(snapshot.prediction.outOfRange?['Source features are outside the training range']:[]),
                ...(workload.summary.hasOpaqueWork ? [`Workload contains server-side/runner boundaries (${workload.summary.opaqueCategories.join(', ')}) not represented by JavaScript syntax features`] : []),
                ...(workload.summary.providerDomains.external_provider > 0 ? ['Workload references external provider endpoints; real external latency is not validated under local simulator baseline'] : [])
            ] : []};
        if (test.opaqueFixtureProvider && !discoveredFixtures) result.input.opaqueFixtureProvider = true;
        if (discoveredFixtures) result.input.lifecycle = 'playwright-discovery-fixtures/v1';
        if (!result.prediction) issues.push({phase:'predictor',id,unit,
            reasons:result.predictionError?.issues ?? [{message:'Missing ML prediction'}]});
        if (unit === 'prefix' && timingBoundary === SEGMENT_TIMING_BOUNDARY && snapshot.prediction)
            result.trainingSnapshot = snapshot;
        return result;
    }
    const fixtureWork = test => (test.fixtureSetup ?? (test.restoration?.fixtures ?? []).filter(f=>f.setup).map(f=>f.setup)).map((source,i)=>({name:`fixture-${i}.js`,source:`async function setup(){${source}}`,role:'work'}));
    const byId = new Map(manifest.tests.map(t=>[t.id,t]));
    function discoveryFixtures(test, callback) {
        const row = options.discoveryByTest?.get(test.id);
        if (!row) return null;
        const snapshot = row.snapshot;
        if (row.discoveryOnly !== true || snapshot?.runner !== 'playwright' || snapshot.unit !== 'test' ||
            snapshot.timingBoundary !== PLAYWRIGHT_TEST_TIMING_BOUNDARY || Object.hasOwn(snapshot,'actualMs'))
            throw Error('Expected discovery-only Playwright lifecycle evidence');
        const config = sources.get(options.discoveryConfig);
        if (!config || row.configDigest !== predictor.sha256(config))
            throw Error('Discovery configuration does not match planner source');
        const archive = new Map(snapshot.sourceArchive.map(entry=>[entry.name,entry]));
        const callbackOrigin = archive.get('callback.js')?.origin;
        const specHash = predictor.sha256(source(test.file));
        if (!callbackOrigin || row.fileHash !== specHash || archive.get(callbackOrigin.file)?.sha256 !== specHash ||
            callbackOrigin.start !== callback.origin.start || callbackOrigin.end !== callback.origin.end)
            throw Error('Discovery callback does not match planner source');
        const context = testContext(test);
        const byHash = new Map();
        for (const item of context) {
            const hash = predictor.sha256(item.source);
            byHash.set(hash,byHash.has(hash) ? null : item);
        }
        return snapshot.sourceArchive.filter(entry=>/^lifecycle-\d+-fixture\.js$/.test(entry.name)).map(entry=>{
            const original = byHash.get(archive.get(entry.origin?.file)?.sha256);
            const {start,end,method} = entry.origin ?? {};
            if (!original || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
                start < 0 || end <= start || end > original.source.length || !['work','context'].includes(entry.role))
                throw Error('Discovery fixture has no verified planner source range');
            const fragment = original.source.slice(start,end);
            const detached = method ? `const work = {${fragment}};` : `const work = ${fragment};`;
            if (predictor.sha256(detached) !== entry.sha256)
                throw Error('Discovery fixture hash does not match its planner source range');
            return {name:entry.name,role:entry.role,origin:{file:original.name,start,end},source:detached};
        });
    }
    for (const test of manifest.tests) {
        const bytes=sources.get(test.file), original=source(test.file);
        const start=bytes.subarray(0,test.callbackStart).toString('utf8').length;
        const end=bytes.subarray(0,test.callbackEnd).toString('utf8').length;
        const peers=runnableByFile.get(test.file) ?? [];
        const work=[{name:'callback.js',source:`const work = ${fragment(test.file,test.callbackStart,test.callbackEnd)};`,role:'work',origin:{file:`spec/${test.file}`,start,end}}];
        if (!specHooks.has(test.file)) specHooks.set(test.file,hooks(original));
        const scopedHooks = specHooks.get(test.file).filter(hook=>start>=hook.scope[0] && end<=hook.scope[1]);
        for (const [index,hook] of [...globalHooks(test),...scopedHooks].entries()) {
            const scoped=hook.file?peers:peers.filter(t=>{const pos=bytes.subarray(0,t.callbackStart).toString('utf8').length;return pos>=hook.scope[0]&&pos<=hook.scope[1];});
            const suiteTitle = test.title.split(' › ').slice(0,-1).join(' › ');
            const peersInSuite = hook.file || hook.scope[0] === 0 || !hook.expanded ? scoped :
                scoped.filter(peer=>peer.title.split(' › ').slice(0,-1).join(' › ')===suiteTitle);
            const once=['before','beforeAll'].includes(hook.kind)?peersInSuite[0]?.id===test.id:['after','afterAll'].includes(hook.kind)?peersInSuite.at(-1)?.id===test.id:true;
            work.push({name:`hook-${index}.js`,source:hook.source,role:once?'work':'context',origin:{file:hook.file ? `context/${hook.file}` : `spec/${test.file}`,start:hook.start,end:hook.end}});
        }
        const discovered = discoveryFixtures(test,work[0]);
        if (discovered) work.push(...discovered);
        else if (test.restoration) for (const frame of test.restoration.fixtures) if(frame.setup || frame.teardown)
            work.push({name:`fixture-${frame.name}.js`,source:`async function fixture(){${frame.setup ?? ''}\n${frame.teardown ?? ''}}`,role:'work'});
        if (!discovered && !test.restoration) work.push(...fixtureWork(test));
        rows[test.id]=forecast(test.id,test,'test',work,test.fixture.startsWith('cypress:')?TEST_TIMING_BOUNDARY:PLAYWRIGHT_TEST_TIMING_BOUNDARY,discovered !== null);
        const rootId=`root-${test.scope.slice(0,20)}`;
        if (!stages[rootId]) {
            const frames=fixtureWork(test);
            stages[rootId]=frames.length?forecast(rootId,test,'prefix',frames,prefixBoundary)
                :{id:rootId,empty:true,prediction:{ms:0,modelId:prefixModel.id,qualified:prefixModel.model.qualified},workload:representWorkload([],{timingBoundary:prefixBoundary,runner:'cypress'})};
        }
    }
    for (const cp of manifest.checkpoints) {
        const test=byId.get(cp.representative);
        const parent=manifest.checkpoints.filter(c=>c.depth<cp.depth&&c.consumers.includes(test.id)).sort((a,b)=>b.depth-a.depth)[0];
        const from=parent?.depth ?? 0;
        const steps = test.steps.slice(from,cp.depth);
        const bytes = sources.get(test.file);
        const offset = byte => bytes.subarray(0,byte).toString('utf8').length;
        const work=cp.depth===0?fixtureWork(test):
            [{name:'prefix.js',source:`async function prefix(){\n${steps.map(s=>fragment(test.file,s.start,s.end)).join('\n')}\n}`,role:'work',
                origin:{file:`spec/${test.file}`,ranges:steps.map(step=>({start:offset(step.start),end:offset(step.end)}))}}];
        if(prefixBoundary===boundary && from===0 && cp.depth>0)work.unshift(...globalHooks(test).filter(h=>h.kind==='beforeEach').map((h,i)=>({
            name:`global-beforeEach-${i}.js`,source:h.source,role:'work',
            origin:{file:`context/${h.file}`,start:h.start,end:h.end}
        })));
        const segment={representative:test.id,fromDepth:from,toDepth:cp.depth};
        const result=work.length?forecast(cp.id,test,'prefix',work,prefixBoundary,false,segment):{id:cp.id,prediction:null,predictionError:{message:'Missing fixture setup source'}};
        // Fixture cost belongs to the fixture checkpoint, never both it and its root.
        if(cp.depth===0) stages[`root-${test.scope.slice(0,20)}`]={id:`root-${test.scope.slice(0,20)}`,empty:true,prediction:{ms:0,modelId:prefixModel.id,qualified:prefixModel.model.qualified},workload:representWorkload([],{timingBoundary:prefixBoundary,runner:'cypress'})};
        result.segment = segment;
        if (result.trainingSnapshot) result.trainingSnapshot.segment = result.segment;
        stages[cp.id]=result;
        candidates.push({id:cp.id,consumers:cp.consumers.length,automatic:cp.automatic,fromDepth:from,toDepth:cp.depth,
            estimatedSegmentMs:result.prediction?.ms ?? null,classification:result.prediction?'ml-estimated':'prediction-failed'});
    }
    return {...manifest,assessment:{version:'ml-duration-v1',prefixTimingBoundary:prefixBoundary,modelId:loaded.id,modelQualified:loaded.model.qualified && prefixModel.model.qualified,
        ...(prefixModel.id !== loaded.id ? {prefixModelId:prefixModel.id} : {}),
        baselineMs,manualMultiplier:options.multiplier ?? 1,status:issues.length?'incomplete':'complete',
        executionEligible:issues.length===0 && [...Object.values(rows),...Object.values(stages)].every(row=>row.empty || row.prediction?.executionEligible===true),
        workloadRepresentation: summarizeWorkloadRepresentations(Object.values(rows), Object.values(stages)),
        analysis:manifest.assessment.analysis,tests:rows,stages,candidates,issues}};
}
module.exports={assess,MODEL_SHA256,boundary};
