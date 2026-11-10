// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const parser = require('@babel/parser');
const {createHash} = require('node:crypto');

const cache = new Map();
const sha256 = value => createHash('sha256').update(value).digest('hex');

function walk(node, visit) {
    const pending = [node];
    while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object') continue;
        if (Array.isArray(value)) { pending.push(...value); continue; }
        if (!value.type) continue;
        visit(value);
        for (const [key, item] of Object.entries(value)) {
            if (!['loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key) && item && typeof item === 'object') {
                pending.push(item);
            }
        }
    }
}

function analyze(source) {
    const key = sha256(source);
    if (cache.has(key)) return cache.get(key);
    let ast;
    try {
        ast = parser.parse(source, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']});
    } catch {
        const empty = {calls: [], methods: []};
        cache.set(key, empty);
        return empty;
    }
    const calls = new Set(), methods = [];
    const callName = n => ['CallExpression', 'OptionalCallExpression', 'NewExpression'].includes(n.type)
        ? (n.callee?.property?.name ?? n.callee?.name)
        : null;

    walk(ast, node => {
        const call = callName(node);
        if (call) calls.add(call);
        let name, body, code;
        if (node.type === 'FunctionDeclaration' && node.id) {
            name = node.id.name;
            body = node;
            code = source.slice(node.start, node.end);
        } else if (node.type === 'ClassMethod' && node.key.type === 'Identifier') {
            name = node.key.name;
            body = node;
            code = 'class Helper {' + source.slice(node.start, node.end) + '}';
        } else if (node.type === 'ObjectMethod' && node.key.type === 'Identifier') {
            name = node.key.name;
            body = node;
            code = 'const helper = {' + source.slice(node.start, node.end) + '};';
        } else if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)) {
            name = node.id.name;
            body = node.init;
            code = 'const ' + name + ' = ' + source.slice(body.start, body.end) + ';';
        }
        if (!name) return;
        const nested = new Set();
        walk(body, n => {
            const nestedCall = callName(n);
            if (nestedCall) nested.add(nestedCall);
        });
        methods.push({name, source: code, calls: [...nested], digest: sha256(code)});
    });
    const result = {calls: [...calls], methods};
    if (cache.size >= 2048) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
}

function reachableContext(sources) {
    const contextSources = sources.filter(s => s.role === 'context');
    if (!contextSources.length) return [];
    const methodsByName = new Map();
    for (const s of contextSources) {
        for (const method of analyze(s.source).methods) {
            if (!methodsByName.has(method.name)) methodsByName.set(method.name, []);
            methodsByName.get(method.name).push(method);
        }
    }
    const pending = sources.filter(s => s.role !== 'context').flatMap(s => analyze(s.source).calls);
    const seenCalls = new Set(), selected = new Map();
    while (pending.length) {
        const name = pending.pop();
        if (seenCalls.has(name)) continue;
        seenCalls.add(name);
        for (const method of methodsByName.get(name) || []) {
            if (!selected.has(method.digest)) {
                selected.set(method.digest, method.source);
                pending.push(...method.calls);
            }
        }
    }
    return [...selected].sort(([a], [b]) => a.localeCompare(b)).map(([digest, source]) => ({
        name: 'reachable-' + digest + '.js',
        role: 'context',
        source
    }));
}

module.exports = {reachableContext, analyze};
