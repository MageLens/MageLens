// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path=require('node:path').posix;
const parser=require('@babel/parser');

function hasConditionalSupportImport(source) {
    const ast=parser.parse(source,{sourceType:'unambiguous',plugins:['typescript','jsx']});
    function visit(node, conditional=false) {
        if (!node?.type) return false;
        if (conditional && node.type==='CallExpression' &&
            (node.callee.type==='Import' || node.callee.type==='Identifier' && node.callee.name==='require'))
            return true;
        return Object.entries(node).some(([key,value])=>{
            const guarded=conditional ||
                ['IfStatement','ConditionalExpression'].includes(node.type) && key!=='test' ||
                node.type==='LogicalExpression' && key==='right' ||
                node.type==='SwitchCase' && key==='consequent';
            return Array.isArray(value) ? value.some(child=>visit(child,guarded)) : visit(value,guarded);
        });
    }
    return visit(ast.program);
}

// Resolve source entry points without importing configuration or application code.
// Runtime configuration/registration may add work; retain that limitation explicitly.
function executionContext(manifest,sources,test,configSelections = new Map(),conditionalImports = new Map()) {
    const dependencies=manifest.sourceDependencies ?? {};
    const closure=roots=>{
        const seen=new Set(),pending=[...roots];
        while(pending.length){const file=pending.pop();if(seen.has(file))continue;seen.add(file);pending.push(...(dependencies[file] ?? []));}
        return seen;
    };
    const files=new Set(test.contextFiles ?? [...sources.keys()]);
    const warnings=[];
    if(!test.fixture.startsWith('cypress:'))return {files,support:[],warnings};
    const configs=[...sources.keys()].filter(file=>/^cypress\.config\.[cm]?[jt]s$/.test(path.basename(file)) &&
        (path.dirname(file)==='.' || test.file.startsWith(path.dirname(file)+'/'))).sort((a,b)=>b.length-a.length);
    const config=configs[0];
    const directory=config?path.dirname(config):test.file.includes('cypress/e2e/')?test.file.slice(0,test.file.indexOf('cypress/e2e/')):'.';
    let selected,explicit=false;
    if(config){
        if (!configSelections.has(config)) {
            const ast=parser.parse(sources.get(config).toString(),{sourceType:'unambiguous',plugins:['typescript','jsx']});
            const pending=[ast],values=[];
            while(pending.length){
                const node=pending.pop();if(!node || typeof node!=='object')continue;
                if(Array.isArray(node)){pending.push(...node);continue;}
                if(node.type==='ObjectProperty' && (node.key.name ?? node.key.value)==='supportFile')values.push(node.value);
                for(const [key,value] of Object.entries(node))if(key!=='loc' && value && typeof value==='object')pending.push(value);
            }
            configSelections.set(config,values.map(value=>({type:value.type,value:value.value})));
        }
        const values=configSelections.get(config);
        if(values.length===1 && ['StringLiteral','BooleanLiteral'].includes(values[0].type)){
            explicit=true;selected=values[0].value;
        } else if(values.length) warnings.push('Dynamic supportFile configuration requires native input verification');
        for(const file of closure([config]))files.add(file);
    }
    let support=[];
    if(selected!==false){
        const candidates=typeof selected==='string'?[path.normalize(path.join(directory,selected))]:
            ['js','ts','jsx','tsx'].map(ext=>path.join(directory,'cypress/support/e2e.'+ext));
        const roots=candidates.filter(file=>sources.has(file));
        if(explicit && !roots.length)throw Error('Configured Cypress support source is missing from the source inventory');
        support=[...closure(roots)].filter(file=>sources.has(file) && /\.[cm]?[jt]sx?$/.test(file));
        for(const file of support) {
            files.add(file);
            if (!conditionalImports.has(file))
                conditionalImports.set(file,hasConditionalSupportImport(sources.get(file).toString()));
            if (conditionalImports.get(file))
                warnings.push(`Conditional Cypress support imports in ${file} require native input verification`);
        }
    }
    return {files,support,warnings};
}

function reconcileWorkloadInputs(staticInput, nativeSnapshot) {
    const staticSources = staticInput?.sources ?? [];
    const nativeSources = nativeSnapshot?.sourceArchive ?? nativeSnapshot?.sources ?? [];

    const staticWork = staticSources.filter(s => (s.role ?? 'work') === 'work');
    const nativeWork = nativeSources.filter(s => (s.role ?? 'work') === 'work');

    const workIdentity = sources => {
        const byName = new Map(sources.map(source => [source.name,source]));
        return source => {
            const origin = source.origin;
            const original = byName.get(origin?.file);
            if (!origin) return source.sha256 ?? null;
            const ranges = origin.ranges ?? [origin];
            if (!original?.sha256 || !ranges.length || ranges.some(({start,end}) =>
                !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start)) return null;
            return JSON.stringify([original.sha256,ranges.map(({start,end})=>[start,end])]);
        };
    };
    const staticIdentity = workIdentity(staticSources);
    const nativeIdentity = workIdentity(nativeSources);

    const staticHooks = staticWork.filter(s => s.name.startsWith('hook-') || s.name.startsWith('global-'));
    const nativeHooks = nativeWork.filter(s => s.name.startsWith('hook-') ||
        /^lifecycle-\d+-(?:beforeEach|afterEach|beforeAll|afterAll)\.js$/.test(s.name));

    function unmatched(actual, expected, identifyActual, identifyExpected) {
        const counts = new Map();
        for (const source of expected) {
            const key = identifyExpected(source);
            if (key === null) continue;
            counts.set(key,(counts.get(key) ?? 0)+1);
        }
        return actual.filter(source => {
            const key = identifyActual(source);
            const count = counts.get(key) ?? 0;
            if (!count) return true;
            counts.set(key,count-1);
            return false;
        });
    }
    const missingSupportHooks = unmatched(nativeHooks,staticHooks,nativeIdentity,staticIdentity);
    const unexpectedHooks = unmatched(staticHooks,nativeHooks,staticIdentity,nativeIdentity);
    const isNativeFixture = source=>/^lifecycle-\d+-fixture\.js$/.test(source.name);
    const staticFixtures = staticWork.filter(source=>source.name.startsWith('fixture-') || isNativeFixture(source));
    const nativeFixtures = nativeWork.filter(isNativeFixture);
    const missingFixtures = unmatched(nativeFixtures,staticFixtures,nativeIdentity,staticIdentity);
    const unexpectedFixtures = unmatched(staticFixtures,nativeFixtures,staticIdentity,nativeIdentity);
    const availableHashes = new Set(staticSources.filter(source=>source.role==='context').map(source=>source.sha256));
    const nativeByName = new Map(nativeSources.map(source=>[source.name,source]));
    const unavailableFixtureOrigins = missingFixtures.filter(source=>{
        const original = nativeByName.get(source.origin?.file);
        return !original?.sha256 || !availableHashes.has(original.sha256);
    });

    const diagnosticHooks = (nativeSnapshot?.environment?.diagnosticHooks ?? [])
        .concat(nativeSources.filter(s => s.diagnostic === true));

    const staticHelpers = new Set(staticInput?.selectedImplementations ?? []);
    const nativeHelpers = new Set(nativeSnapshot?.selectedImplementations ?? []);

    const missingHelpers = [...nativeHelpers].filter(h => !staticHelpers.has(h));
    const unexpectedHelpers = [...staticHelpers].filter(h => !nativeHelpers.has(h));

    const staticCallback = staticWork.find(s => s.name === 'callback.js');
    const nativeCallback = nativeWork.find(s => s.name === 'callback.js');
    const staticCallbackIdentity = staticCallback ? staticIdentity(staticCallback) : null;
    const callbackMatch = Boolean(staticCallbackIdentity && nativeCallback && staticCallbackIdentity === nativeIdentity(nativeCallback));

    const extractionMatch = staticInput?.extracted !== false && nativeSnapshot?.extracted !== false &&
        (!staticInput?.featureSchema || !nativeSnapshot?.featureSchema || staticInput.featureSchema === nativeSnapshot.featureSchema);
    const executionOrderDifferences = ['execution.first','execution.last'].filter(key =>
        staticInput?.extraFeatures?.[key] !== nativeSnapshot?.extraFeatures?.[key]);
    const matched = !staticInput?.opaqueFixtureProvider && extractionMatch && executionOrderDifferences.length === 0 &&
                    missingFixtures.length === 0 && unexpectedFixtures.length === 0 && missingSupportHooks.length === 0 &&
                    unexpectedHooks.length === 0 &&
                    missingHelpers.length === 0 &&
                    unexpectedHelpers.length === 0 &&
                    callbackMatch;

    const discrepancies = [];
    if (staticInput?.opaqueFixtureProvider) discrepancies.push('Static Playwright fixture provider requires native lifecycle inputs');
    if (!extractionMatch) discrepancies.push('Feature extraction failed or feature schemas differ');
    if (executionOrderDifferences.length) discrepancies.push('First or last runnable test ownership differs');
    if (!callbackMatch) discrepancies.push('Work callback differs between static and native representations');
    if (missingSupportHooks.length) discrepancies.push(`${missingSupportHooks.length} support hook(s) observed natively are missing from static planning`);
    if (unexpectedHooks.length) discrepancies.push(`${unexpectedHooks.length} support hook(s) planned statically were not observed natively`);
    if (missingFixtures.length || unexpectedFixtures.length) discrepancies.push('Fixture work differs between static and native representations');
    if (missingHelpers.length) discrepancies.push(`${missingHelpers.length} helper implementation(s) reached natively are missing from static planning`);
    if (unexpectedHelpers.length) discrepancies.push(`${unexpectedHelpers.length} helper implementation(s) planned statically were not reached natively`);

    return {
        matched,
        extractionMatch,
        executionOrderDifferences,
        callbackMatch,
        missingSupportHooks: missingSupportHooks.map(h => h.name),
        unexpectedHooks: unexpectedHooks.map(h => h.name),
        missingFixtures: missingFixtures.map(fixture=>fixture.name),
        unavailableFixtureOrigins: unavailableFixtureOrigins.map(fixture=>fixture.name),
        unexpectedFixtures: unexpectedFixtures.map(fixture=>fixture.name),
        diagnosticHooks: [...new Set(diagnosticHooks.map(h => typeof h === 'string' ? h : (h.name ?? h.source)))],
        missingHelpers,
        unexpectedHelpers,
        staticWorkloadCount: staticWork.length,
        nativeWorkloadCount: nativeWork.length,
        discrepancies
    };
}

module.exports = {executionContext, reconcileWorkloadInputs};
