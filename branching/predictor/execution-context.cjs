// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path=require('node:path').posix;
const parser=require('@babel/parser');

// Resolve source entry points without importing configuration or application code.
// Runtime configuration/registration may add work; retain that limitation explicitly.
function executionContext(manifest,sources,test) {
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
        const ast=parser.parse(sources.get(config).toString(),{sourceType:'unambiguous',plugins:['typescript','jsx']});
        const pending=[ast],values=[];
        while(pending.length){
            const node=pending.pop();if(!node || typeof node!=='object')continue;
            if(Array.isArray(node)){pending.push(...node);continue;}
            if(node.type==='ObjectProperty' && (node.key.name ?? node.key.value)==='supportFile')values.push(node.value);
            for(const [key,value] of Object.entries(node))if(key!=='loc' && value && typeof value==='object')pending.push(value);
        }
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
        for(const file of support)files.add(file);
    }
    return {files,support,warnings};
}
module.exports={executionContext};
