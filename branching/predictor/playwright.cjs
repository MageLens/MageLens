// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path = require('node:path');
const {EstimationError} = require('../estimation.cjs');
function fail(message) { throw new EstimationError([{phase:'predictor',message}]); }
function functionSource(fn) {
    if(typeof fn!=='function')fail('Missing loaded Playwright function');
    const source=Function.prototype.toString.call(fn);
    // Function expressions and object methods have different enclosing syntax.
    for(const wrapped of [`const work = ${source};`,`const work = {${source}};`]) {
        try { require('@babel/parser').parse(wrapped); return wrapped; } catch { /* Try method syntax. */ }
    }
    fail('Loaded Playwright function has no parseable source');
}
function runtime() {
    const root=path.dirname(require.resolve('playwright/package.json'));
    if(require(path.join(root,'package.json')).version!=='1.65.0')fail('Fixture profiling requires pinned Playwright 1.65.0');
    const {fixtures,poolBuilder}=require(path.join(root,'lib/common/index.js'));
    return {root,fixtures,poolBuilder};
}
function describe(test, api=runtime()) {
    if(!test._testType || !test.parent || !api.fixtures?.fixtureParameterNames || !api.poolBuilder?.PoolBuilder)
        fail('Playwright fixture metadata is unavailable');
    const parents=[];
    for(let parent=test.parent;parent;parent=parent.parent)parents.unshift(parent);
    const project=parents.find(parent=>parent._fullProject)?._fullProject;
    const pool=api.poolBuilder.PoolBuilder.createForWorker(project)._buildPoolForTest(test);
    const sources=[],files=new Set(),selected=new Map();
    const add=(fn,location,role,kind)=>{
        if(typeof fn!=='function')return;
        if(!location?.file || !path.isAbsolute(location.file))fail('Loaded Playwright fixture has no physical source file');
        if(location.file.startsWith(api.root+path.sep))return; // Runner implementation is represented by its pinned version.
        files.add(location.file);
        sources.push({name:`lifecycle-${sources.length}-${kind}.js`,source:functionSource(fn),role});
    };
    const visit=(registration,role)=>{
        if(!registration)fail('Unresolved loaded Playwright fixture');
        const ownRole=registration.scope==='worker'||registration.timeout!==undefined?'context':role;
        if(selected.has(registration) && (selected.get(registration)==='work'||ownRole==='context'))return;
        selected.set(registration,ownRole);
        for(const name of registration.deps)visit(pool.resolve(name,registration),role);
    };
    const dependencies=(fn,location,role)=>{
        for(const name of api.fixtures.fixtureParameterNames(fn,location,error=>fail(error.message)))visit(pool.resolve(name),role);
    };
    dependencies(test.fn,test.location,'work');
    for(const registration of pool.autoFixtures())visit(registration,'work');
    for(const parent of parents) {
        if(!Array.isArray(parent._hooks))fail('Playwright hook metadata is unavailable');
        for(const hook of parent._hooks) {
            // beforeAll/afterAll use separate timeout slots, excluded from TestResult.duration.
            const role=['beforeEach','afterEach'].includes(hook.type)?'work':'context';
            add(hook.fn,hook.location,role,hook.type);
            dependencies(hook.fn,hook.location,role);
        }
        for(const modifier of parent._modifiers ?? []) {
            const names=api.fixtures.fixtureParameterNames(modifier.fn,modifier.location,error=>fail(error.message));
            const role=names.some(name=>pool.resolve(name)?.scope==='test')?'work':'context';
            add(modifier.fn,modifier.location,role,'modifier');
            dependencies(modifier.fn,modifier.location,role);
        }
    }
    for(const [registration,role] of selected) {
        // Undefined option overrides inherit the original callback but receive a
        // virtual project location. Keep the callback's actual source provenance.
        let origin=registration;
        while(origin.optionOverride && origin.super?.fn===origin.fn)origin=origin.super;
        add(registration.fn,origin.location,role,'fixture');
    }
    return {timingSource:functionSource(test.fn),timingSources:sources,files:[...files]};
}
module.exports={describe,functionSource};
