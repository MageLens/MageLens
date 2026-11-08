// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Data graphs preserve aliases/cycles. Browser objects are recipes, never stale
// protocol handles. Constructors and fixture preparation are not replayed.
const locatorMethods=new Set(['locator','getByRole','getByText','getByLabel','getByPlaceholder','getByAltText','getByTitle','getByTestId','filter','first','last','nth','and','or','frameLocator']);
class FixtureCodec {
    constructor(runtime,factory){this.runtime=runtime;this.factory=factory;this.handles=new WeakMap();this.roots=new Map();}
    handle(root,steps=[]) {
        if(!steps.length&&this.roots.has(root))return this.roots.get(root);
        let target=root==='request'?this.runtime.context?.request:this.runtime[root];
        if(!target)return undefined;
        for(const step of steps)target=target[step.method](...step.args);
        const proxy=new Proxy(target,{get:(object,key)=>{
            if(key==='then')return undefined;
            if(key==='context'&&root==='page'&&!steps.length)return ()=>this.handle('context');
            if(key==='request'&&['page','context'].includes(root)&&!steps.length)return this.handle('request');
            const value=Reflect.get(object,key,object);
            if(typeof value!=='function')return value;
            if(locatorMethods.has(key))return (...args)=>this.handle(root,[...steps,{method:key,args:args.map(value=>this.argument(value))}]);
            return (...args)=>this.result(value.apply(object,args));
        }});
        this.handles.set(proxy,{root,steps});if(!steps.length)this.roots.set(root,proxy);return proxy;
    }
    result(value) {
        if(value&&value===this.runtime.page)return this.handle('page');
        if(value&&value===this.runtime.context)return this.handle('context');
        if(value&&value===this.runtime.context?.request)return this.handle('request');
        if(Array.isArray(value))return value.map(item=>this.result(item));
        return value;
    }
    argument(value) {
        if(value===null||typeof value!=='object'||this.handles.has(value))return value;
        if(value instanceof RegExp)return new RegExp(value.source,value.flags);
        if(Array.isArray(value))return value.map(v=>this.argument(v));
        if(Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Unsupported locator recipe argument');
        return Object.fromEntries(Object.entries(value).map(([key,value])=>[key,this.argument(value)]));
    }
    encode(value) {
        const nodes=[],seen=new Map();
        const visit=value=>{
            if(value===undefined)return {type:'undefined'};
            if(typeof value==='bigint')return {type:'bigint',value:String(value)};
            if(typeof value==='number'&&!Number.isFinite(value))return {type:'number',value:String(value)};
            if(Object.is(value,-0))return {type:'number',value:'-0'};
            if(value===null||['string','boolean','number'].includes(typeof value))return {value};
            if(typeof value!=='object')throw new Error(`Cannot checkpoint fixture ${typeof value}`);
            if(seen.has(value))return {ref:seen.get(value)};
            if(nodes.length>=50000)throw new Error('Fixture state exceeds 50000 objects');
            const id=nodes.length;seen.set(value,id);nodes.push(null);let node;
            if(this.handles.has(value)){const handle=this.handles.get(value);node={kind:'handle',root:handle.root,steps:handle.steps.map(s=>({method:s.method,args:s.args.map(visit)}))};}
            else if(value instanceof Date||value instanceof Map||value instanceof Set||value instanceof RegExp) {
                const type=value instanceof Date?Date:value instanceof Map?Map:value instanceof Set?Set:RegExp;
                if(Object.getPrototypeOf(value)!==type.prototype||Reflect.ownKeys(value).some(key=>!(type===RegExp&&key==='lastIndex')))throw new Error('Cannot checkpoint customized fixture built-in');
                node=type===Date?{kind:'date',value:value.toISOString()}:type===Map?{kind:'map',entries:[...value].map(([k,v])=>[visit(k),visit(v)])}:type===Set?{kind:'set',entries:[...value].map(visit)}:{kind:'regexp',source:value.source,flags:value.flags,lastIndex:value.lastIndex,lastIndexWritable:Object.getOwnPropertyDescriptor(value,'lastIndex').writable};
            }
            else {
                const prototype=Object.getPrototypeOf(value),classId=this.factory.prototypes.get(prototype);
                if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null&&!classId)throw new Error('Cannot checkpoint fixture live handle or unregistered prototype');
                const properties=[];
                for(const key of Reflect.ownKeys(value)) {
                    if(Array.isArray(value)&&key==='length')continue;
                    const descriptor=Object.getOwnPropertyDescriptor(value,key);
                    if(typeof key!=='string'||!Object.hasOwn(descriptor,'value'))throw new Error('Cannot checkpoint fixture symbol or accessor');
                    properties.push([key,visit(descriptor.value),{writable:descriptor.writable,enumerable:descriptor.enumerable,configurable:descriptor.configurable}]);
                }
                node={kind:Array.isArray(value)?'array':'object',...(classId?{classId}:{}),nullPrototype:prototype===null,properties,...(Array.isArray(value)?{length:value.length,lengthWritable:Object.getOwnPropertyDescriptor(value,'length').writable}:{})};
            }
            node.extensible=Object.isExtensible(value);
            nodes[id]=node;return {ref:id};
        };
        const result={root:visit(value),nodes};if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)throw new Error('Fixture state exceeds 8 MiB');return result;
    }
    decode(graph) {
        if(!Array.isArray(graph.nodes)||graph.nodes.length>50000)throw new Error('Invalid fixture graph');
        const values=graph.nodes.map(n=>n.kind==='array'?new Array(n.length):n.kind==='object'?Object.create(n.classId?this.factory.get(n.classId).prototype:n.nullPrototype?null:Object.prototype):n.kind==='date'?new Date(n.value):n.kind==='map'?new Map():n.kind==='set'?new Set():n.kind==='regexp'?new RegExp(n.source,n.flags):null);
        const populated=new Set();
        const read=entry=>{
            if(Object.hasOwn(entry,'value')&&!entry.type)return entry.value;
            if(entry.type==='undefined')return undefined;
            if(entry.type==='bigint')return BigInt(entry.value);
            if(entry.type==='number')return entry.value==='-0'?-0:Number(entry.value);
            const node=graph.nodes[entry.ref];if(!node)throw new Error('Invalid fixture reference');
            if(!populated.has(entry.ref)) {
                populated.add(entry.ref);
                if(node.kind==='handle')values[entry.ref]=this.handle(node.root,node.steps.map(s=>({method:s.method,args:s.args.map(read)})));
                if(node.properties)for(const [key,value,descriptor] of node.properties)Object.defineProperty(values[entry.ref],key,{...descriptor,value:read(value)});
                if(node.kind==='map')for(const [key,value] of node.entries)values[entry.ref].set(read(key),read(value));
                if(node.kind==='set')for(const value of node.entries)values[entry.ref].add(read(value));
                if(node.kind==='regexp')Object.defineProperty(values[entry.ref],'lastIndex',{value:node.lastIndex,writable:node.lastIndexWritable});
                if(node.kind==='array')Object.defineProperty(values[entry.ref],'length',{writable:node.lengthWritable});
                if(!node.extensible&&node.kind!=='handle')Object.preventExtensions(values[entry.ref]);
            }
            return values[entry.ref];
        };
        return read(graph.root);
    }
}
module.exports={FixtureCodec};
