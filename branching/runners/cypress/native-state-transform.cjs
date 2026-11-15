// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {createHash} = require('node:crypto');
function instrument(source, entries) {
    if (entries.some(entry=>entry.sha256!==createHash('sha256').update(source).digest('hex')))
        throw new Error('Native state source changed');
    const found = new Set();
    const plugin=({types:t})=>({visitor:{'Program|Function':{exit(p) {
            const start = Buffer.byteLength(source.slice(0,p.node.start));
            for (const entry of entries.filter(entry=>entry.scopeStart===start &&
                entry.scopeType===(p.isProgram()?'Program':'Function'))) {
                if (found.has(entry)) throw new Error('Ambiguous native state scope');
                const body = p.isProgram() ? p : p.get('body');
                if (!body.isProgram() && !body.isBlockStatement()) throw new Error('Native state scope has no statement body');
                const properties = [];
                for (const [name, mode] of Object.entries(entry.bindings)) {
                    if (!t.isValidIdentifier(name) || !['read','write'].includes(mode)) throw new Error('Invalid native state binding');
                    const binding = p.scope.getOwnBinding(name);
                    if (!binding || (mode==='write' && ['const','module'].includes(binding.kind)))
                        throw new Error('Native state binding cannot be accessed in this scope');
                    properties.push(t.objectMethod('get',t.identifier(name),[],t.blockStatement([t.returnStatement(t.identifier(name))])));
                    if (mode==='write') properties.push(t.objectMethod('set',t.identifier(name),[t.identifier('value')],
                        t.blockStatement([t.expressionStatement(t.assignmentExpression('=',t.identifier(name),t.identifier('value')))])));
                }
                // Getter creation is safe before initialization. No value is
                // read until the adapter explicitly requests an initialized cell.
                body.unshiftContainer('body',t.expressionStatement(t.callExpression(t.memberExpression(
                    t.callExpression(t.identifier('require'),[t.stringLiteral(require.resolve('./native-state.cjs'))]),t.identifier('register')),
                [t.stringLiteral(entry.id),t.objectExpression(properties)])));
                found.add(entry);
            }
        }}}});
    return {plugin,check:()=>{if(found.size!==entries.length)throw new Error('Native state scope was not found');}};
}
function transform(source,filename,entries) {
    const access=instrument(source,entries);
    const result=require('@babel/core').transformSync(source,{filename,sourceMaps:true,sourceFileName:filename,
        configFile:false,babelrc:false,parserOpts:{sourceType:'unambiguous',plugins:['typescript','jsx']},plugins:[access.plugin]});
    access.check();return {code:result.code,map:result.map};
}
module.exports={transform,instrument};
