// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {stripTypeScriptTypes}=require('node:module');
const {FixtureCodec}=require('./fixture-values.cjs');
function compile(code) {
    try {return new Function('__get','__expect','"use strict";\n'+code);}
    catch(error) {
        if(!(error instanceof SyntaxError))throw error;
        const transformed=stripTypeScriptTypes('function __factory(__get,__expect){"use strict";\n'+code+'\n}',{mode:'transform'});
        return new Function(transformed+'\nreturn __factory;')();
    }
}
class Factory {
    constructor(recipe,expect,program) {
        this.recipe=recipe;this.expect=expect;this.values=new Map();this.prototypes=new Map();this.compiled=new Map();this.frames=new Map();
        if(program){this.compiled=program.compiled;this.fixtures=program.fixtures;return;}
        for(const [id,definition] of Object.entries(recipe.functions)) {
            const bindings=Object.entries(definition.bindings).map(([name,value])=>`const ${name}=${value.ref?`__get(${JSON.stringify(value.ref)})`:value.builtin==='expect'?'__expect':value.builtin==='undefined'?'undefined':JSON.stringify(value.value)};`).join('\n');
            this.compiled.set(id,compile(bindings+`\nreturn (${definition.code});`));
            this.frames.set(id,code=>compile(bindings+'\nreturn '+code+';'));
        }
        // Compile every continuation before backend setup, including teardown.
        this.fixtures=recipe.fixtures.map(f=>!f.function?f:{...f,
            setupFunction:this.frames.get(f.function)(`async (__inputs)=>{const ${f.parameters}=__inputs;\n${f.setup}\nconst __value=(${f.valueExpression});return {value:__value,locals:{${f.locals.join(',')}}};}`),
            teardownFunction:this.frames.get(f.function)(`async (__inputs,__locals)=>{const ${f.parameters}=__inputs;let {${f.locals.join(',')}}=__locals;\n${f.teardown}\n}`)});
    }
    get=(id)=>{
        if(!this.values.has(id)) {
            const value=this.compiled.get(id)(this.get,this.expect);this.values.set(id,value);
            if(typeof value==='function'&&value.prototype)this.prototypes.set(value.prototype,id);
        }
        return this.values.get(id);
    };
    initialize(){for(const id of this.compiled.keys())this.get(id);}
}
class FixtureState {
    constructor(manifest,configuration) {
        this.tests=new Map(manifest.tests.filter(t=>t.restoration).map(t=>[t.id,t]));
        this.expect=configuration.expect??require('@playwright/test').expect;this.active=null;this.programs=new Map();
        for(const test of this.tests.values()) {
            if(test.restoration.version!==1)throw new Error('Unsupported fixture restoration recipe; replan');
            if(!this.programs.has(test.scope)) {
                const functions=Object.assign({},...([...this.tests.values()].filter(t=>t.scope===test.scope).map(t=>t.restoration.functions)));
                this.programs.set(test.scope,new Factory({...test.restoration,functions},this.expect));
            }
        }
    }
    factory(test) {
        const program=this.programs.get(test.scope);
        return new Factory(program.recipe,this.expect,program);
    }
    async prepare(test,runtime) {
        await this.cleanup(runtime);
        const factory=this.factory(test);factory.initialize();
        const codec=new FixtureCodec(runtime,factory);
        const values={page:codec.handle('page'),context:codec.handle('context'),request:codec.handle('request'),baseURL:runtime.browserState?.baseURL??runtime.baseURL};
        this.active={test:test.id,scope:test.scope,factory,codec,values,frames:[]};
        try {
            for(const fixture of factory.fixtures) {
                if(!fixture.function){values[fixture.name]=structuredClone(fixture.value);continue;}
                const frame=await fixture.setupFunction(factory.get,this.expect)(values);
                values[fixture.name]=frame.value;
                this.active.frames.push({name:fixture.name,locals:frame.locals});
            }
            this.capture(runtime); // Reject unsupported handles before capture or suffix execution.
        } catch(error) {
            try {await this.cleanup(runtime);}catch(cleanup){throw new AggregateError([error,cleanup],'Fixture setup and teardown failed',{cause:cleanup});}
            throw error;
        }
    }
    capture() {
        if(!this.active)return null;
        const {test,scope,codec,values,frames}=this.active;
        return {version:1,test,scope,graph:codec.encode({values,frames})};
    }
    async restore(snapshot,runtime) {
        // Validation restores can replace an unconsumed frame. Only a test's
        // completion (or abandoned setup cleanup) owns user teardown.
        if(snapshot===null){this.active=null;return;}
        const test=this.tests.get(snapshot.test);
        if(snapshot.version!==1||!test||test.scope!==snapshot.scope)throw new Error('Incompatible fixture checkpoint');
        const factory=this.factory(test);factory.initialize();
        const codec=new FixtureCodec(runtime,factory);const {values,frames}=codec.decode(snapshot.graph);
        this.active={test:test.id,scope:test.scope,factory,codec,values,frames};
    }
    async run(test,runtime) {
        if(this.active?.scope!==test.scope)throw new Error('Missing restored fixture frame');
        let error;
        try {
            // A sibling has its own callback, with the same restored fixture graph.
            await this.active.factory.get(test.restoration.callback)(this.active.values);
        }catch(cause){error=cause;}
        try {await this.cleanup(runtime);}catch(cause){error=error?new AggregateError([error,...(cause instanceof AggregateError?cause.errors:[cause])],'Test and fixture teardown failed: '+error.message+'; '+cause.message):cause;}
        if(error)throw error;
    }
    async cleanup() {
        const active=this.active;if(!active)return;
        this.active=null;const errors=[];
        for(const frame of [...active.frames].reverse()) {
            const fixture=active.factory.fixtures.find(f=>f.name===frame.name);
            try {await fixture.teardownFunction(active.factory.get,this.expect)(active.values,frame.locals);}catch(error){errors.push(error);}
        }
        if(errors.length)throw new AggregateError(errors,'Fixture teardown failed: '+errors.map(e=>e.message).join('; '));
    }
}
module.exports={FixtureState};
