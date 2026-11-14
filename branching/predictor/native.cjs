// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {TEST_TIMING_BOUNDARY,PLAYWRIGHT_TEST_TIMING_BOUNDARY} = require('./prefix-measurement.cjs');
const fs = require('node:fs'), path = require('node:path');
const p = require('./index.cjs');
const {EstimationError} = require('../estimation.cjs');
const callbackMetadata = new Set([
    'start','end','loc','extra','leadingComments','innerComments','trailingComments',
    'typeAnnotation','returnType','typeParameters','typeArguments'
]);

function callbackSyntax(node) {
    if (Array.isArray(node)) return node.map(callbackSyntax);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.keys(node).sort().filter(key => !callbackMetadata.has(key))
        .map(key => [key,callbackSyntax(node[key])]));
}

const testRegistrationNames = new Set(['it','specify','test']);
const hookRegistrationNames = new Set(['before','after','beforeEach','afterEach','beforeAll','afterAll']);

function registrationName(callee) {
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type !== 'MemberExpression' || callee.computed) return undefined;
    return ['skip','only','fixme','fail'].includes(callee.property.name)
        ? registrationName(callee.object) : callee.property.name;
}

function callbackOrigins(original, file) {
    const parser = require('@babel/parser');
    const options = {sourceType:'unambiguous', plugins:['typescript','jsx']};
    const kinds = ['ArrowFunctionExpression', 'FunctionExpression'];
    const program = parser.parse(original, options).program;
    const pending = [program], matches = new Map(), syntaxMatches = new Map(), locations = new Map(), fixtures = new Map();
    while (pending.length) {
        const node = pending.pop();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node)) {
            pending.push(...node);
            continue;
        }
        if (node.type === 'CallExpression') {
            const position = `${node.loc.start.line}:${node.loc.start.column+1}`;
            const [definitions] = node.arguments;
            if (definitions?.type === 'ObjectExpression' &&
                ['extend','use'].includes(node.callee.property?.name) &&
                definitions.properties.every(property => !property.computed && property.key)) {
                const bindings = new Map();
                for (const property of definitions.properties) {
                    const name = property.key.name ?? property.key.value;
                    const value = property.value?.type === 'ArrayExpression' ? property.value.elements[0] : property.value;
                    const fn = property.type === 'ObjectMethod' ? property : value;
                    if (kinds.includes(fn?.type) || fn?.type === 'ObjectMethod')
                        bindings.set(name,{file,start:fn.start,end:fn.end,method:fn.type === 'ObjectMethod'});
                    else bindings.delete(name);
                }
                fixtures.set(position,bindings);
                const member = node.callee.property.loc.start;
                fixtures.set(`${member.line}:${member.column+1}`,bindings);
            }
            const callback = node.arguments.findLast(arg => kinds.includes(arg.type));
            if (callback) locations.set(`${node.loc.start.line}:${node.loc.start.column+1}`,
                {file,start:callback.start,end:callback.end,registration:registrationName(node.callee)});
        }
        if (kinds.includes(node.type) || node.type === 'ObjectMethod') {
            const bytes = original.slice(node.start,node.end);
            const origin = {file,start:node.start,end:node.end,method:node.type === 'ObjectMethod'};
            matches.set(bytes, matches.has(bytes) ? null : origin);
            const syntax = JSON.stringify(callbackSyntax(node));
            syntaxMatches.set(syntax,syntaxMatches.has(syntax) ? null : origin);
        }
        for (const value of Object.values(node)) if (value && typeof value === 'object') pending.push(value);
    }
    return (wrapped, location, fixtureName, expectedNames) => {
        const position = location && `${location.line}:${location.column}`;
        const located = fixtureName === undefined ? locations.get(position) : fixtures.get(position)?.get(fixtureName);
        if (located && (!expectedNames || expectedNames.has(located.registration))) {
            const {registration: _registration,...origin} = located;
            return origin;
        }
        const expression = parser.parse(wrapped, options).program.body[0]?.declarations?.[0]?.init;
        const callback = expression?.type === 'ObjectExpression' && expression.properties.length === 1
            ? expression.properties[0] : expression;
        if (!callback) return undefined;
        const bytes = wrapped.slice(callback.start,callback.end);
        const normalized = syntaxMatches.get(JSON.stringify(callbackSyntax(callback)));
        return normalized === null ? null : matches.get(bytes) ?? normalized;
    };
}
function localDependencies(file, source, root, packageRoots = []) {
    const parser = require('@babel/parser');
    const ast = parser.parse(source,{sourceType:'unambiguous',plugins:['typescript','jsx']});
    const pending = [ast.program], dependencies = new Set();
    const extensions = ['', '.js', '.ts', '.jsx', '.tsx', '.cjs', '.mjs', '/index.js', '/index.ts'];
    while (pending.length) {
        const node = pending.pop();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node)) {
            pending.push(...node);
            continue;
        }
        const staticModule = ['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type);
        const specifier = staticModule ? node.source?.value :
            (node.type === 'CallExpression' && node.callee.name === 'require' && node.arguments.length === 1
                ? node.arguments[0].value : undefined);
        if (typeof specifier === 'string' && /^\.\.?\//.test(specifier)) {
            const target = path.resolve(path.dirname(file),specifier);
            for (const extension of extensions) {
                const candidate = target + extension;
                if (!candidate.startsWith(root+path.sep) || !/\.[cm]?[jt]sx?$/.test(candidate)) continue;
                if (!fs.statSync(candidate,{throwIfNoEntry:false})?.isFile()) continue;
                if (fs.realpathSync(candidate) === candidate) dependencies.add(candidate);
                break;
            }
        } else if (typeof specifier === 'string' && packageRoots.length && !path.isAbsolute(specifier)) {
            let candidate;
            try { candidate = require('node:module').createRequire(file).resolve(specifier); }
            catch (error) {
                if (!['MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
            }
            if (candidate && /\.[cm]?[jt]sx?$/.test(candidate) &&
                packageRoots.some(directory=>candidate.startsWith(directory+path.sep)) && fs.realpathSync(candidate) === candidate)
                dependencies.add(candidate);
        }
        for (const value of Object.values(node)) if (value && typeof value === 'object') pending.push(value);
    }
    return dependencies;
}

function collector(profile, directory, root, {onPrepared} = {}) {
    const model = profile.model ? p.loadModel(profile.model,profile.modelDigest) : null;
    const v5 = (model?.model.featureSchema ?? profile.featureSchema) === p.REACHABLE_SCHEMA_V5;
    const file = path.join(directory,'predictions.json');
    return batch => {
        const preparationStarted = performance.now();
        const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
        const firstRow = rows.length;
        const original = fs.readFileSync(batch.file,'utf8'), fileHash=p.sha256(original);
        const inputs = new Map([[batch.file,original]]);
        const pending = [...(profile.files ?? []), ...(batch.files ?? []),
            ...(v5 ? [profile.supportFile,profile.configFile].filter(file=>typeof file === 'string' && file) : [])].map(file=>path.resolve(root,file));
        const sourceRoot = path.resolve(root);
        const externalRoots = new Set();
        if (v5 && profile.runner === 'playwright') {
            for (const file of pending) {
                if (file.startsWith(sourceRoot+path.sep)) continue;
                const boundary = file.indexOf(path.sep+'node_modules'+path.sep);
                if (boundary >= 0) externalRoots.add(file.slice(0,boundary));
            }
        }
        const dependencies = (file,source) => {
            if (!v5 || !/\.[cm]?[jt]sx?$/.test(file)) return;
            const dependencyRoot = file.startsWith(sourceRoot+path.sep) ? sourceRoot :
                [...externalRoots].find(candidate=>file.startsWith(path.join(candidate,'node_modules')+path.sep));
            if (dependencyRoot) pending.push(...localDependencies(file,source,
                dependencyRoot === sourceRoot ? sourceRoot : path.join(dependencyRoot,'node_modules'),
                [...externalRoots].map(directory=>path.join(directory,'node_modules'))));
        };
        dependencies(batch.file,original);
        while (pending.length) {
            const file = pending.pop();
            if (inputs.has(file)) continue;
            const source = fs.readFileSync(file,'utf8');
            inputs.set(file,source);
            dependencies(file,source);
        }
        const context = [...inputs.keys()].filter(file=>file!==batch.file).sort()
            .map(file=>({file,source:inputs.get(file)}));
        const files=[{file:batch.file,hash:fileHash},...context.map(item=>({file:item.file,hash:p.sha256(item.source)}))];
        const runnableTests = batch.tests.filter(test=>test.expectedStatus !== 'skipped');
        const scopedTests = new Map(batch.hooks.map(hook => [hook, runnableTests.filter(test =>
            hook.scope.every((title,i) => test.titlePath[i] === title))]));
        const isDiagnostic = hook => hook.diagnostic === true;
        const relSpec = path.relative(root, batch.file).replaceAll(path.sep, '/');
        const specName = relSpec.startsWith('..') ? 'spec.js' : `spec/${relSpec}`;
        const modules = new Map([[batch.file,{name:specName,source:original}]]);
        const contextSources = context.map((item,i) => {
            const rel = path.relative(root,item.file).replaceAll(path.sep,'/');
            const external = [...externalRoots].find(candidate=>item.file.startsWith(path.join(candidate,'node_modules')+path.sep));
            const name = external ? `context/${path.relative(external,item.file).split(path.sep).join('/')}` :
                rel.startsWith('..') ? `context-${i}.js` : `context/${rel}`;
            const entry = {name,source:item.source,role:'context'};
            modules.set(item.file,entry);
            return entry;
        });
        const maps = new Map();
        function mappedRegistrationLocation(hook) {
            const generated = hook.generatedLocation;
            const encoded = generated && batch.sourceMaps?.[generated.url];
            if (typeof encoded !== 'string' || encoded.length > 16 * 1024 * 1024) return undefined;
            try {
                if (!maps.has(generated.url)) {
                    const payload = JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
                    maps.set(generated.url,{payload,map:new (require('node:module').SourceMap)(payload)});
                }
                const {payload,map} = maps.get(generated.url);
                const entry = map.findEntry(generated.line-1,generated.column-1);
                const content = payload.sourcesContent?.[payload.sources.indexOf(entry.originalSource)];
                if (typeof content !== 'string') return undefined;
                const candidates = [...modules].filter(([,source])=>source.source===content);
                if (candidates.length === 1)
                    return {file:candidates[0][0],line:entry.originalLine+1,column:entry.originalColumn+1};
            } catch { /* Invalid maps supply no attribution. */ }
            return undefined;
        }
        const finders = new Map();
        function finder(file) {
            const module = modules.get(file);
            if (!finders.has(file)) finders.set(file,callbackOrigins(module.source,module.name));
            return finders.get(file);
        }
        function attribute(source, file, location, fixtureName, searchModules = false, expectedNames) {
            if (!v5 || !modules.has(file)) return source;
            let origin;
            if (searchModules) {
                for (const candidate of modules.keys()) {
                    const match = finder(candidate)(source.source);
                    if (match === null || (match && origin)) return source;
                    if (match) {
                        origin = match;
                        file = candidate;
                    }
                }
            } else origin = finder(file)(source.source,location,fixtureName,expectedNames);
            const module = modules.get(file);
            if (!origin) return source;
            const fragment = module.source.slice(origin.start,origin.end);
            const restored = origin.method ? `const work = {${fragment}};` : `const work = ${fragment};`;
            return {...source,origin,source:source.source.includes(fragment) ? source.source : restored};
        }
        const timingOrder = v5 ? runnableTests : batch.tests;
        for (const [index,test] of timingOrder.entries()) {
            if (test.expectedStatus === 'skipped') continue;
            const hooks = batch.hooks.filter(h => h.scope.every((title,i) => test.titlePath[i] === title));
            const workloadHooks = hooks.filter(h => !isDiagnostic(h));
            const diagnosticHooks = hooks.filter(h => isDiagnostic(h));
            const mappedTest = mappedRegistrationLocation(test);
            const sources = [
                attribute({name:'callback.js',source:test.timingSource,role:'work'},mappedTest?.file ?? batch.file,
                    profile.runner === 'playwright' ? test : mappedTest ?? test.timingLocation,undefined,false,testRegistrationNames),
                {name:specName,source:original,role:'context'},
                ...workloadHooks.map((h,i) => {
                    const location = mappedRegistrationLocation(h) ?? h.timingLocation;
                    const mapped = modules.has(location?.file);
                    const role = (h.kind === 'before' && scopedTests.get(h)[0]?.id !== test.id) ||
                        (h.kind === 'after' && scopedTests.get(h).at(-1)?.id !== test.id) ? 'context' : 'work';
                    return attribute({name:`hook-${i}.js`,source:h.source,role},mapped ? location.file : batch.file,
                        mapped ? location : undefined,undefined,!mapped,new Set([h.kind]));
                }),
                ...diagnosticHooks.map((h,i)=>({name:`diagnostic-hook-${i}.js`,source:h.source,role:'context',diagnostic:true})),
                ...(test.timingSources ?? []).map(({location,kind,fixtureName,...source}) =>
                    attribute(source,location?.file,kind === 'fixture' && fixtureName === undefined ? undefined : location,fixtureName,
                        false,kind === 'fixture' ? undefined : hookRegistrationNames)),
                ...contextSources
            ];
            const runner=profile.runner ?? 'cypress';
            const snapshot=p.prepare({runner,unit:'test',sources,backendState:profile.backendState,featureSchema:profile.featureSchema,sourceStore:profile.sourceStore,
                timingBoundary:runner==='cypress'?TEST_TIMING_BOUNDARY:PLAYWRIGHT_TEST_TIMING_BOUNDARY,
                sourceFamily:profile.sourceFamily,group:profile.group ?? path.relative(root,batch.file).replaceAll(path.sep,'/'),
                environment:{...profile.environment,hookAttribution:'scoped-once/v1',...(batch.lifecycle?{lifecycle:batch.lifecycle}:{}),
                    ...(diagnosticHooks.length ? {diagnosticHooks: diagnosticHooks.map(h => h.source)} : {}),
                    boundary:runner==='cypress'?TEST_TIMING_BOUNDARY:PLAYWRIGHT_TEST_TIMING_BOUNDARY},
                baselineMs:profile.baselineMs,manualMultiplier:profile.multiplier ?? 1,
                extraFeatures:{...profile.extraFeatures,'execution.first':Number(index===0),'execution.last':Number(index===timingOrder.length-1)}},model);
            rows.push({id:test.id,file:batch.file,fileHash,files,snapshot,...(profile.discoveryOnly ? {
                discoveryOnly:true,...(profile.configDigest ? {configDigest:profile.configDigest} : {})
            } : {})});
        }
        // Cypress attributes this root before hook to the first runnable test.
        // Record the measured collector work separately; never estimate or
        // retrospectively subtract overhead from older observations.
        if (onPrepared) onPrepared(rows.slice(firstRow).map(({id,snapshot})=>({id,snapshot})));
        if ((profile.runner ?? 'cypress') === 'cypress' && !profile.discoveryOnly && rows[firstRow])
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
    const dependencyProjects = new Set((report.config?.projects ?? []).flatMap(project =>
        [...(project.dependencies ?? []), ...(project.teardown ? [project.teardown] : [])]));
    const setupIds = new Set((report.tests ?? []).filter(t => dependencyProjects.has(t.project)).map(t => t.id));
    const pending = JSON.parse(fs.readFileSync(file));
    if (pending.some(row => row.discoveryOnly)) throw new Error('Discovery snapshots cannot produce timing observations');
    const rows=pending.map(row=>{
        const result=report.results.find(r=>r.id===row.id);
        if (!result || !(result.durationMs>0)) return {...row.snapshot,eligible:false,exclusion:'Missing or invalid native result',actualMs:null};
        const unchanged=(row.files ?? [{file:row.file,hash:row.fileHash}]).every(item=>
            fs.existsSync(item.file) && p.sha256(fs.readFileSync(item.file))===item.hash);
        const preparationMs = row.preparationMs ?? 0;
        const actualMs = result.durationMs - preparationMs;
        if (!Number.isFinite(preparationMs) || preparationMs < 0 || !(actualMs > 0))
            throw new EstimationError([{phase:'predictor',message:'Invalid measured preparation overhead'}]);
        const observation = {...p.observe(row.snapshot,actualMs,{passed:result.status==='passed' && !result.errors.length,
            attempts:result.attempts,sourceDigest:unchanged?row.snapshot.sourceDigest:'changed'}),
            timing:{nativeMs:result.durationMs,preparationMs}};
        // Retain the measured work and source audit for diagnostics while
        // keeping project dependencies out of individual-test qualification.
        return setupIds.has(row.id) ? {...observation, eligible:false, lifecycleDependency:true,
            exclusion:observation.exclusion ?? 'Project lifecycle dependency'} : observation;
    });
    fs.writeFileSync(path.join(directory,'prediction-samples.json'),JSON.stringify(rows)+'\n',{mode:0o600});
    return p.evaluate(rows);
}
module.exports={collector,finish,sourceAt};
