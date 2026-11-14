// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const parser = require('@babel/parser');
const {createHash} = require('node:crypto');
const path = require('node:path').posix;
const {EstimationError} = require('../estimation.cjs');

const sha256 = value => createHash('sha256').update(value).digest('hex');

const fileParseCache = new Map();
const analyzeCache = new Map();

const JS_BUILTINS = new Set([
    'Object', 'Function', 'Boolean', 'Symbol', 'Error', 'AggregateError',
    'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
    'Number', 'BigInt', 'Math', 'Date', 'String', 'RegExp',
    'Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
    'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics',
    'JSON', 'Promise', 'Generator', 'GeneratorFunction', 'AsyncFunction',
    'Reflect', 'Proxy', 'Intl', 'WebAssembly',
    'eval', 'isFinite', 'isNaN', 'parseFloat', 'parseInt',
    'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape',
    'console', 'process', 'Buffer', 'global', 'globalThis', 'window', 'document', 'navigator',
    'location', 'history', 'screen', 'performance', 'crypto', 'fetch', 'Headers', 'Request', 'Response',
    'FormData', 'URL', 'URLSearchParams', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'setImmediate', 'clearImmediate', 'queueMicrotask', 'AbortController', 'AbortSignal',
    'Event', 'EventTarget', 'CustomEvent', 'MessageChannel', 'MessagePort', 'TextEncoder', 'TextDecoder',
    'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'localStorage', 'sessionStorage',
    'indexedDB', 'XMLHttpRequest', 'WebSocket', 'Worker', 'Blob', 'File', 'FileReader'
]);

const CYPRESS_RUNNER_COMMANDS = new Set([
    'visit', 'get', 'contains', 'find', 'filter', 'not', 'first', 'last', 'eq', 'closest',
    'children', 'parents', 'parent', 'siblings', 'prev', 'next', 'click', 'dblclick',
    'rightclick', 'check', 'uncheck', 'select', 'type', 'clear', 'focus', 'blur', 'submit',
    'scrollIntoView', 'scrollTo', 'trigger', 'wait', 'pause', 'screenshot', 'viewport',
    'url', 'title', 'location', 'hash', 'window', 'document', 'root', 'wrap', 'then',
    'should', 'and', 'each', 'spread', 'its', 'invoke', 'as', 'request', 'intercept',
    'fixture', 'readFile', 'writeFile', 'exec', 'task', 'session', 'origin', 'clock', 'tick',
    'spy', 'stub', 'reload', 'setCookie', 'getCookie', 'getCookies', 'clearCookie', 'clearCookies',
    'clearLocalStorage', 'getAllLocalStorage', 'clearAllLocalStorage', 'getAllSessionStorage'
]);

function walkAst(node, visit) {
    const pending = [node];
    while (pending.length) {
        const item = pending.pop();
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item)) { pending.push(...item); continue; }
        if (!item.type) continue;
        visit(item);
        for (const [key, val] of Object.entries(item)) {
            if (!['loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key) && val && typeof val === 'object') {
                pending.push(val);
            }
        }
    }
}

function hasSuper(node) {
    let uses = false;
    walkAst(node, child => {
        if (child.type === 'Super' || (child.type === 'CallExpression' && child.callee?.type === 'Super')) {
            uses = true;
        }
    });
    return uses;
}

function makeParseable(code, node, source) {
    try {
        parser.parse(code, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']});
        return code;
    } catch (err) {
        if (err.reasonCode === 'UnexpectedSuper') {
            const wrapped = 'class Helper extends Parent {\nconstructor() {\n' + code + '\n}\n}';
            try {
                parser.parse(wrapped, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']});
                return wrapped;
            } catch { /* Try next wrapping */ }
        }
        const funcWrapped = 'async function __wrapper() {\n' + source.slice(node.start, node.end) + '\n}';
        try {
            parser.parse(funcWrapped, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']});
            return funcWrapped;
        } catch { /* Fallback to raw snippet */ }
        return code;
    }
}

class Scope {
    constructor(parent = null, kind = parent ? 'function' : 'module') {
        this.parent = parent;
        this.kind = kind;
        this.bindings = new Map();
    }
    variableScope() {
        return this.kind === 'block' ? this.parent.variableScope() : this;
    }
    set(name, binding) {
        this.bindings.set(name, binding);
    }
    get(name) {
        if (this.bindings.has(name)) return this.bindings.get(name);
        return this.parent ? this.parent.get(name) : null;
    }
    has(name) {
        return this.get(name) !== null;
    }
}

function resolveModulePath(fromFile, specifier, fileModules) {
    if (!specifier || path.isAbsolute(specifier)) return null;
    const exts = ['', '.js', '.ts', '.jsx', '.tsx', '.cjs', '.mjs', '/index.js', '/index.ts', '/index.cjs', '/index.mjs'];
    function find(target) {
        for (const ext of exts) {
            const candidate = target + ext;
            if (fileModules.has(candidate)) return candidate;
            if (fileModules.has('context/' + candidate)) return 'context/' + candidate;
        }
        return null;
    }

    const directory = path.dirname(fromFile.replace(/^(?:spec|context)\//,''));
    if (path.isAbsolute(directory)) return null;
    if (specifier.startsWith('.')) return find(path.join(directory,specifier));

    for (let current = directory; ; current = path.dirname(current)) {
        const candidate = find(path.join(current,'node_modules',specifier));
        if (candidate || path.dirname(current) === current || current === '.') return candidate;
    }
}

function parseFile(fileEntry) {
    const {name, source, role = 'work'} = fileEntry;
    const cacheKey = sha256(JSON.stringify([name, role, source]));
    if (fileParseCache.has(cacheKey)) {
        return fileParseCache.get(cacheKey);
    }

    let ast;
    try {
        const options = {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']};
        try {
            ast = parser.parse(source, options);
        } catch (error) {
            if (role !== 'context' || error.reasonCode !== 'IllegalReturn') throw error;
            ast = parser.parse(source, {...options,allowReturnOutsideFunction:true});
            if (ast.program.sourceType === 'module') throw error;
        }
    } catch (error) {
        throw new EstimationError([{phase: 'predictor', message: `Cannot parse reachability source ${name}: ${error.message}`}]);
    }

    const classes = new Map();
    const methods = new Map();
    const functions = new Map();
    const functionsByNode = new Map();
    const exports = new Map();
    const starExports = [];
    const imports = new Map();
    const calls = [];
    const commands = new Map();
    const tasks = new Map();

    const rootScope = new Scope();
    const classDefinitions = new WeakMap();

    for (const stmt of ast.program.body) {
        if (stmt.type === 'ImportDeclaration') {
            const specifier = stmt.source.value;
            for (const s of stmt.specifiers) {
                if (s.type === 'ImportDefaultSpecifier') {
                    imports.set(s.local.name, {specifier, importedName: 'default'});
                    rootScope.set(s.local.name, {kind: 'import', specifier, importedName: 'default'});
                } else if (s.type === 'ImportNamespaceSpecifier') {
                    imports.set(s.local.name, {specifier, importedName: '*'});
                    rootScope.set(s.local.name, {kind: 'import', specifier, importedName: '*', valueType: 'module'});
                } else if (s.type === 'ImportSpecifier') {
                    const imported = s.imported.name ?? s.imported.value;
                    imports.set(s.local.name, {specifier, importedName: imported});
                    rootScope.set(s.local.name, {kind: 'import', specifier, importedName: imported});
                }
            }
        } else if (stmt.type === 'ExportNamedDeclaration') {
            if (stmt.declaration) {
                if (stmt.declaration.type === 'FunctionDeclaration' && stmt.declaration.id) {
                    exports.set(stmt.declaration.id.name, {localName: stmt.declaration.id.name});
                } else if (stmt.declaration.type === 'ClassDeclaration' && stmt.declaration.id) {
                    exports.set(stmt.declaration.id.name, {localName: stmt.declaration.id.name});
                } else if (stmt.declaration.type === 'VariableDeclaration') {
                    for (const decl of stmt.declaration.declarations) {
                        if (decl.id.type === 'Identifier') exports.set(decl.id.name, {localName: decl.id.name});
                    }
                }
            }
            if (stmt.specifiers) {
                for (const s of stmt.specifiers) {
                    const local = s.local.name;
                    const exported = s.exported.name ?? s.exported.value;
                    if (stmt.source) {
                        exports.set(exported, {reexport: {specifier: stmt.source.value, importedName: local}});
                    } else {
                        exports.set(exported, {localName: local});
                    }
                }
            }
        } else if (stmt.type === 'ExportDefaultDeclaration') {
            if (stmt.declaration.id) {
                exports.set('default', {localName: stmt.declaration.id.name});
            } else {
                exports.set('default', {declarationNode: stmt.declaration});
            }
        } else if (stmt.type === 'ExportAllDeclaration') {
            starExports.push({specifier: stmt.source.value, importedName: '*'});
        } else if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'AssignmentExpression') {
            const left = stmt.expression.left;
            if (left.type === 'MemberExpression') {
                if (left.object?.name === 'module' && left.property?.name === 'exports') {
                    if (stmt.expression.right.type === 'ObjectExpression') {
                        for (const prop of stmt.expression.right.properties) {
                            if (!prop.computed && prop.key) {
                                const key = prop.key.name ?? prop.key.value;
                                if (typeof key !== 'string') continue;
                                const value = prop.value ?? prop;
                                exports.set(key, value.type === 'Identifier'
                                    ? {localName:value.name} : {declarationNode:value});
                            }
                        }
                    } else if (stmt.expression.right.type === 'Identifier') {
                        exports.set('default', {localName: stmt.expression.right.name});
                    } else {
                        exports.set('default', {declarationNode:stmt.expression.right});
                    }
                } else if (left.object?.name === 'exports' && left.property?.name) {
                    const value = stmt.expression.right;
                    exports.set(left.property.name, value.type === 'Identifier'
                        ? {localName:value.name} : {declarationNode:value});
                }
            }
        }
    }

    const exportedFunctionNodes = new Set([...exports.values()].map(entry=>entry.declarationNode).filter(Boolean));

    function registerClass(node, scope = rootScope) {
        const className = node.id?.name;
        if (!className) return null;
        let superClassName = null;
        if (node.superClass) {
            superClassName = node.superClass.name ?? node.superClass.property?.name ?? null;
        }
        const clsInfo = {
            name: className,
            superClassName,
            declarationScope: scope,
            file: name,
            methods: new Map(),
            constructorMethod: null,
            node
        };
        if (scope === rootScope) classes.set(className, clsInfo);
        classDefinitions.set(node, clsInfo);
        scope.set(className, {kind: 'class', clsInfo});
        return clsInfo;
    }

    function registerMethod(classNode, methodNode) {
        const clsName = classNode?.id?.name ?? 'Helper';
        let methodName = null;
        if (methodNode.key.type === 'Identifier') methodName = methodNode.key.name;
        else if (methodNode.key.type === 'PrivateName') methodName = '#' + methodNode.key.id.name;
        if (!methodName) return null;

        const isConstructor = methodNode.kind === 'constructor';
        const usesSuper = hasSuper(methodNode) || Boolean(classNode?.superClass);
        let rawCode = 'class ' + clsName + (usesSuper ? ' extends Parent' : '') + ' {\n' + source.slice(methodNode.start, methodNode.end) + '\n}';
        let code = makeParseable(rawCode, methodNode, source);
        const digest = sha256(code);
        const methodInfo = {
            id: `${name}#${clsName}${methodNode.static ? "." : ".prototype."}${methodName}`,
            name: methodName,
            className: clsName,
            classInfo: classDefinitions.get(classNode) ?? null,
            isConstructor,
            usesSuper,
            source: code,
            digest,
            file: name,
            node: methodNode,
            calls: []
        };
        methods.set(digest, methodInfo);
        if (classDefinitions.has(classNode)) {
            const cls = classDefinitions.get(classNode);
            if (isConstructor) cls.constructorMethod = methodInfo;
            else cls.methods.set((methodNode.static ? "static:" : "instance:") + methodName, methodInfo);
        }
        return methodInfo;
    }

    function registerFunction(node, nameOpt, scope = rootScope, bindingName = nameOpt ?? node.id?.name) {
        const funcName = nameOpt ?? node.id?.name;
        if (!funcName) return null;
        const usesSuper = hasSuper(node);
        let rawCode = node.type === 'FunctionDeclaration'
            ? source.slice(node.start, node.end)
            : 'const ' + funcName + ' = ' + source.slice(node.start, node.end) + ';';
        let code = makeParseable(rawCode, node, source);
        const digest = sha256(code);
        const funcInfo = {
            id: `${name}#${funcName}`,
            name: funcName,
            className: null,
            isConstructor: false,
            usesSuper,
            source: code,
            digest,
            file: name,
            node,
            calls: []
        };
        functions.set(digest, funcInfo);
        functionsByNode.set(node,funcInfo);
        methods.set(digest, funcInfo);
        if (bindingName) scope.set(bindingName, {kind: 'function', funcInfo});
        return funcInfo;
    }

    function bindPattern(node, scope, kind = 'parameter') {
        if (!node) return;
        if (node.type === 'Identifier') scope.set(node.name, {kind});
        else if (node.type === 'AssignmentPattern') bindPattern(node.left, scope, kind);
        else if (node.type === 'RestElement') bindPattern(node.argument, scope, kind);
        else if (node.type === 'ObjectPattern') for (const property of node.properties) bindPattern(property.value ?? property.argument, scope, kind);
        else if (node.type === 'ArrayPattern') for (const element of node.elements) bindPattern(element, scope, kind);
    }

    function traverse(node, scope, currentEnclosing, parent = null) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) traverse(child, scope, currentEnclosing, parent);
            return;
        }
        if (!node.type) return;

        let nextScope = scope;
        let nextEnclosing = currentEnclosing;

        if (['BlockStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'CatchClause'].includes(node.type)) {
            nextScope = new Scope(scope, 'block');
            if (node.type === 'CatchClause') bindPattern(node.param, nextScope);
        } else if (node._methodInfo) {
            nextEnclosing = node._methodInfo;
            nextScope = new Scope(scope);
        } else if (node.type === 'ClassDeclaration') {
            const clsInfo = registerClass(node, scope);
            nextEnclosing = { kind: 'class', className: clsInfo?.name, classNode: node, clsInfo };
            nextScope = new Scope(scope);
        } else if (node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') {
            const methodInfo = registerMethod(currentEnclosing?.classNode ?? null, node);
            nextEnclosing = methodInfo;
            nextScope = new Scope(scope);
        } else if (node.type === 'FunctionDeclaration') {
            const funcInfo = registerFunction(node, undefined, scope);
            nextEnclosing = funcInfo;
            nextScope = new Scope(scope);
        } else if (node.type === 'VariableDeclarator') {
            const bindingScope = parent?.kind === 'var' ? scope.variableScope() : scope;
            if (node.id.type === 'Identifier') {
                const varName = node.id.name;
                if (node.init && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init.type)) {
                    const funcInfo = registerFunction(node.init, varName, bindingScope);
                    bindingScope.set(varName, {kind: 'function', funcInfo});
                    nextEnclosing = funcInfo;
                } else if (node.init?.type === 'NewExpression') {
                    bindingScope.set(varName, {kind: 'const', valueType: 'instance', constructorNode:node.init.callee, classScope: scope});
                } else if (node.init?.type === 'CallExpression' && node.init.callee?.name === 'require' && node.init.arguments[0]?.type === 'StringLiteral') {
                    const spec = node.init.arguments[0].value;
                    bindingScope.set(varName, {kind: 'const', valueType: 'module', specifier: spec, importedName: '*', requireScope:scope});
                } else {
                    bindingScope.set(varName, {kind: 'const'});
                }
            } else if (node.id.type === 'ObjectPattern' && node.init?.type === 'CallExpression' && node.init.callee?.name === 'require' && node.init.arguments[0]?.type === 'StringLiteral') {
                const spec = node.init.arguments[0].value;
                bindPattern(node.id, bindingScope, 'const');
                for (const prop of node.id.properties) {
                    if (prop.type === 'ObjectProperty' && prop.value.type === 'Identifier') {
                        const local = prop.value.name;
                        const imported = prop.key.name ?? prop.key.value;
                        bindingScope.set(local, {kind: 'import', specifier: spec, importedName: imported, requireScope:scope});
                    }
                }
            } else bindPattern(node.id, bindingScope, 'const');
        } else if (node.type === 'ObjectMethod' && node.key.type === 'Identifier') {
            const methodName = node.key.name;
            const rawCode = 'const helper = {\n' + source.slice(node.start, node.end) + '\n};';
            const code = makeParseable(rawCode, node, source);
            const digest = sha256(code);
            const methodInfo = {
                id: `${name}#${methodName}`,
                name: methodName,
                className: null,
                isConstructor: false,
                usesSuper: false,
                source: code,
                digest,
                file: name,
                node,
                calls: []
            };
            methods.set(digest, methodInfo);
            functionsByNode.set(node,methodInfo);
            nextEnclosing = methodInfo;
            nextScope = new Scope(scope);
        }

        if (['FunctionExpression', 'ArrowFunctionExpression'].includes(node.type) && !node._methodInfo) {
            nextScope = new Scope(scope);
            if (exportedFunctionNodes.has(node))
                nextEnclosing = registerFunction(node,node.id?.name ?? '__exported',nextScope,node.id?.name ?? null);
        }
        if (Array.isArray(node.params)) for (const parameter of node.params) bindPattern(parameter, nextScope);

        if (node.type === 'CallExpression') {
            const callee = node.callee;
            if (callee.type === 'MemberExpression' &&
                callee.object?.type === 'MemberExpression' &&
                callee.object.object?.name === 'Cypress' && !scope.get('Cypress') &&
                callee.object.property?.name === 'Commands' &&
                ['add', 'overwrite'].includes(callee.property?.name) &&
                node.arguments[0]?.type === 'StringLiteral') {
                const cmdName = node.arguments[0].value;
                const fnArg = node.arguments.findLast(a => ['ArrowFunctionExpression', 'FunctionExpression'].includes(a.type));
                if (fnArg) {
                    const rawCode = 'const command = {' + JSON.stringify(cmdName) + ': ' + source.slice(fnArg.start,fnArg.end) + '};';
                    const code = makeParseable(rawCode, fnArg, source);
                    const digest = sha256(code);
                    const cmdInfo = {
                        id: `${name}#Cypress.Commands.${cmdName}`,
                        name: cmdName,
                        commandName: cmdName,
                        className: null,
                        isConstructor: false,
                        usesSuper: hasSuper(fnArg),
                        source: code,
                        digest,
                        file: name,
                        node: fnArg,
                        calls: []
                    };
                    fnArg._methodInfo = cmdInfo;
                    methods.set(digest, cmdInfo);
                    commands.set(cmdName, commands.has(cmdName) ? null : cmdInfo);
                }
            }

            if (callee.type === 'Identifier' && callee.name === 'on' &&
                node.arguments[0]?.value === 'task' &&
                node.arguments[1]?.type === 'ObjectExpression') {
                for (const prop of node.arguments[1].properties) {
                    let taskName = null, fnNode = null;
                    if (prop.type === 'ObjectMethod') {
                        taskName = prop.computed ? prop.key.value : prop.key.name ?? prop.key.value;
                        fnNode = prop;
                    } else if (prop.type === 'ObjectProperty' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(prop.value?.type)) {
                        taskName = prop.computed ? prop.key.value : prop.key.name ?? prop.key.value;
                        fnNode = prop.value;
                    }
                    if (taskName && fnNode) {
                        let rawCode;
                        if (fnNode.type === 'ObjectMethod') {
                            rawCode = 'const tasks = {' + source.slice(fnNode.start,fnNode.end) + '};';
                        } else {
                            rawCode = 'const tasks = {' + JSON.stringify(taskName) + ': ' + source.slice(fnNode.start,fnNode.end) + '};';
                        }
                        const code = makeParseable(rawCode, fnNode, source);
                        const digest = sha256(code);
                        const taskInfo = {
                            id: `${name}#task.${taskName}`,
                            name: taskName,
                            taskName,
                            className: null,
                            isConstructor: false,
                            usesSuper: false,
                            source: code,
                            digest,
                            file: name,
                            node: fnNode,
                            calls: []
                        };
                        fnNode._methodInfo = taskInfo;
                        methods.set(digest, taskInfo);
                        tasks.set(taskName, tasks.has(taskName) ? null : taskInfo);
                    }
                }
            }
        }

        if (['CallExpression', 'OptionalCallExpression', 'NewExpression'].includes(node.type)) {
            const callSite = extractCallSite(node, scope, name, currentEnclosing);
            if (callSite) {
                calls.push(callSite);
                if (currentEnclosing?.calls) {
                    currentEnclosing.calls.push(callSite);
                }
            }
        }

        for (const [key, val] of Object.entries(node)) {
            if (!['loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key) && val && typeof val === 'object') {
                traverse(val, nextScope, nextEnclosing, node);
            }
        }
    }

    function extractCallSite(node, scope, fileName, enclosing) {
        const isNew = node.type === 'NewExpression';
        const callee = node.callee;
        let kind = isNew ? 'new' : 'direct';
        let calleeName = null;
        let receiverNode = null;
        let receiverName = null;
        let propertyName = null;
        let isForward = false;

        if (callee.type === 'Identifier') {
            calleeName = callee.name;
        } else if (callee.type === 'Super') {
            kind = 'super';
            calleeName = 'super';
        } else if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
            kind = 'member';
            propertyName = callee.computed ? callee.property?.value ?? null : callee.property?.name ?? null;
            receiverNode = callee.object;
            if (receiverNode?.type === 'Identifier') {
                receiverName = receiverNode.name;
            } else if (receiverNode?.type === 'ThisExpression') {
                receiverName = 'this';
            } else if (receiverNode?.type === 'Super') {
                receiverName = 'super';
            }

            if (['call', 'apply'].includes(propertyName) && receiverNode) {
                isForward = true;
                if (receiverNode.type === 'Identifier') {
                    kind = 'direct';
                    calleeName = receiverNode.name;
                    receiverNode = null;
                    receiverName = null;
                    propertyName = null;
                } else if (receiverNode.type === 'MemberExpression' || receiverNode.type === 'OptionalMemberExpression') {
                    kind = 'member';
                    propertyName = receiverNode.computed ? receiverNode.property?.value ?? null : receiverNode.property?.name ?? null;
                    receiverNode = receiverNode.object;
                    receiverName = receiverNode?.type === 'Identifier' ? receiverNode.name :
                        receiverNode?.type === 'ThisExpression' ? 'this' :
                        receiverNode?.type === 'Super' ? 'super' : null;
                }
            }
        }

        return {
            node,
            kind,
            calleeName,
            receiverNode,
            receiverName,
            propertyName,
            isForward,
            isNew,
            args: node.arguments,
            scope,
            fileName,
            enclosing
        };
    }

    traverse(ast.program, rootScope, null);

    const parsed = {
        functionsByNode,
        name,
        source,
        role,
        ast,
        classes,
        methods,
        functions,
        exports,
        starExports,
        imports,
        calls,
        commands,
        tasks,
        rootScope
    };

    if (fileParseCache.size >= 2048) fileParseCache.delete(fileParseCache.keys().next().value);
    fileParseCache.set(cacheKey, parsed);
    return parsed;
}

function isChainedCypress(node) {
    if (!node) return false;
    let curr = node;
    while (curr && ['CallExpression','OptionalCallExpression'].includes(curr.type) && (curr.callee?.type === 'MemberExpression' || curr.callee?.type === 'OptionalMemberExpression')) {
        curr = curr.callee.object;
    }
    return curr?.type === 'Identifier' && curr.name === 'cy';
}

function findClassInModule(mod, className) {
    return mod?.rootScope.get(className)?.clsInfo ?? null;
}

function classReference(mod, node, scope, fileModules) {
    if (!node) return null;
    if (node.type === 'Identifier') {
        const binding = scope?.get(node.name);
        if (binding?.requireScope?.has('require')) return null;
        if (binding?.clsInfo) return binding.clsInfo;
        if (binding?.kind === 'import') return resolveImport(mod, binding.specifier, binding.importedName, fileModules).clsInfo ?? null;
        return binding ? null : findClassInModule(mod, node.name);
    }
    if (node.type === 'MemberExpression' && node.object.type === 'Identifier') {
        const binding = scope?.get(node.object.name);
        if (binding?.requireScope?.has('require')) return null;
        const property = node.computed ? node.property.value : node.property.name;
        if (binding?.valueType === 'module' && typeof property === 'string') return resolveImport(mod, binding.specifier, property, fileModules).clsInfo ?? null;
    }
    return null;
}
function superClass(clsInfo, fileModules) {
    return classReference(fileModules.get(clsInfo.file), clsInfo.node.superClass, clsInfo.declarationScope, fileModules);
}
function findMethodInHierarchy(clsInfo, methodName, fileModules, isStatic, seen = new Set()) {
    if (!clsInfo || seen.has(clsInfo)) return null;
    seen.add(clsInfo);
    const key = (isStatic ? "static:" : "instance:") + methodName;
    if (clsInfo.methods.has(key)) return clsInfo.methods.get(key);
    return findMethodInHierarchy(superClass(clsInfo, fileModules), methodName, fileModules, isStatic, seen);
}
function findConstructorInHierarchy(clsInfo, fileModules, seen = new Set()) {
    if (!clsInfo || seen.has(clsInfo)) return null;
    seen.add(clsInfo);
    if (clsInfo.constructorMethod) return clsInfo.constructorMethod;
    return findConstructorInHierarchy(superClass(clsInfo, fileModules), fileModules, seen);
}

function resolveImport(currentMod, specifier, importedName, fileModules, seen = new Set()) {
    if (!currentMod) return {status: 'unresolved', reason: 'missing_module_origin'};
    const targetFile = resolveModulePath(currentMod.name, specifier, fileModules);
    if (!targetFile || !fileModules.has(targetFile)) {
        return {status: 'unresolved', reason: 'module_not_found', specifier};
    }
    const key = JSON.stringify([targetFile, importedName]);
    if (seen.has(key)) return {status: 'unresolved', reason: 'cyclic_reexport', importedName, targetFile};
    seen = new Set([...seen, key]);
    const targetMod = fileModules.get(targetFile);
    if (importedName === '*') {
        return {status: 'resolved_module', module: targetMod};
    }
    const exp = targetMod.exports.get(importedName);
    if (exp) {
        if (exp.reexport) {
            return resolveImport(targetMod, exp.reexport.specifier, exp.reexport.importedName, fileModules, seen);
        }
        if (exp.localName) {
            const binding = targetMod.rootScope.get(exp.localName);
            if (binding?.requireScope?.has('require')) return {status:'unresolved',reason:'shadowed_require'};
            if (binding?.funcInfo) return {status: 'resolved', target: binding.funcInfo};
            if (binding?.clsInfo) return {status: 'resolved_class', clsInfo: binding.clsInfo};
            if (binding?.kind === 'import') return resolveImport(targetMod, binding.specifier, binding.importedName, fileModules, seen);
        }
        if (exp.declarationNode) {
            const target = targetMod.functionsByNode.get(exp.declarationNode);
            if (target) return {status:'resolved',target};
        }
    }
    const starMatches = new Map();
    for (const star of targetMod.starExports) {
        const res = resolveImport(targetMod, star.specifier, importedName, fileModules, seen);
        if (res.status === 'resolved') starMatches.set(res.target, res);
        if (res.status === 'resolved_class') starMatches.set(res.clsInfo, res);
    }
    if (starMatches.size === 1) return starMatches.values().next().value;
    if (starMatches.size > 1) return {status: 'unresolved', reason: 'ambiguous_export', importedName, targetFile};
    return {status: 'unresolved', reason: 'export_not_found', importedName, targetFile};
}

function resolveCall(callSite, fileModules, allCommands, allTasks) {
    const { kind, calleeName, receiverName, receiverNode, propertyName, scope, fileName, enclosing, args } = callSite;
    const currentModule = fileModules.get(fileName);

    if (callSite.node.type === 'NewExpression' && kind === 'member') {
        const clsInfo = classReference(currentModule,callSite.node.callee,scope,fileModules);
        return clsInfo ? {status:'resolved_class',clsInfo} : {status:'unresolved',reason:'dynamic_constructor'};
    }

    if (kind === 'direct' || kind === 'new') {
        const name = calleeName;
        if (!name) return { status: 'unresolved', reason: 'dynamic_callee' };

        const binding = scope?.get(name);
        if (!binding && JS_BUILTINS.has(name)) {
            return { status: 'builtin', name };
        }

        if (binding) {
            if (binding.requireScope?.has('require')) return {status:'unresolved',reason:'shadowed_require',name};
            if (binding.funcInfo) return { status: 'resolved', target: binding.funcInfo };
            if (binding.clsInfo) return { status: 'resolved_class', clsInfo: binding.clsInfo };
            if (binding.kind === 'import') {
                return resolveImport(currentModule, binding.specifier, binding.importedName, fileModules);
            }
            return {status: 'unresolved', reason: 'unresolved_lexical_binding', name};
        }

        return { status: 'unresolved', reason: 'not_found', name };
    }

    if (kind === 'member') {
        if (receiverName && JS_BUILTINS.has(receiverName)) {
            const binding = scope?.get(receiverName);
            if (!binding) {
                return { status: 'builtin', receiver: receiverName, property: propertyName };
            }
        }

        if (typeof propertyName !== 'string') return {status:'unresolved',reason:'dynamic_dispatch'};

        if (!scope?.get('cy') && (receiverName === 'cy' || isChainedCypress(receiverNode))) {
            if (propertyName === 'task') {
                const taskNameArg = args[0]?.value;
                if (typeof taskNameArg === 'string' && allTasks.has(taskNameArg)) {
                    const target = allTasks.get(taskNameArg);
                    return target ? {status:'resolved',target} : {status:'unresolved',reason:'ambiguous_cypress_task',taskName:taskNameArg};
                }
                return { status: 'unresolved', reason: 'unknown_cypress_task', taskName: typeof taskNameArg === 'string' ? taskNameArg : undefined };
            }
            if (allCommands.has(propertyName)) {
                const target = allCommands.get(propertyName);
                return target ? {status:'resolved',target} : {status:'unresolved',reason:'ambiguous_cypress_command'};
            }
            if (CYPRESS_RUNNER_COMMANDS.has(propertyName)) {
                return { status: 'cypress_builtin', command: propertyName };
            }
            return { status: 'unresolved', reason: 'unknown_cypress_command', command: propertyName };
        }

        if (receiverName === 'this' || receiverName === 'super') {
            const enclosingClsName = enclosing?.className;
            if (enclosingClsName) {
                const clsInfo = enclosing.classInfo ?? findClassInModule(currentModule, enclosingClsName);
                if (clsInfo) {
                    const startCls = (receiverName === 'super' && clsInfo.superClassName)
                        ? superClass(clsInfo, fileModules)
                        : clsInfo;
                    const method = findMethodInHierarchy(startCls, propertyName, fileModules, !!enclosing.node?.static);
                    if (method) return { status: 'resolved', target: method };
                }
            }
            return { status: 'unresolved', reason: 'unresolved_this_or_super', property: propertyName };
        }

        let targetClass = null;
        let isStatic = true;
        if (receiverNode?.type === 'NewExpression') {
            isStatic = false;
            targetClass = classReference(currentModule,receiverNode.callee,scope,fileModules);
        } else if (receiverName) {
            const binding = scope?.get(receiverName);
            if (binding?.requireScope?.has('require')) return {status:'unresolved',reason:'shadowed_require'};
            if (binding?.valueType === 'instance') {
                isStatic = false;
                targetClass = classReference(currentModule,binding.constructorNode,binding.classScope,fileModules);
            } else if (binding?.valueType === 'module') {
                return resolveImport(currentModule, binding.specifier, propertyName, fileModules);
            } else if (binding?.kind === 'import') {
                targetClass = resolveImport(currentModule,binding.specifier,binding.importedName,fileModules).clsInfo ?? null;
            }
            if (binding?.clsInfo) targetClass = binding.clsInfo;
        }

        if (targetClass) {
            const method = findMethodInHierarchy(targetClass, propertyName, fileModules, isStatic);
            if (method) return { status: 'resolved', target: method };
        }

        return { status: 'unresolved', reason: 'dynamic_dispatch', receiver: receiverName, property: propertyName };
    }

    if (kind === 'super') {
        const enclosingClsName = enclosing?.className;
        if (enclosingClsName) {
            const clsInfo = enclosing.classInfo ?? findClassInModule(currentModule, enclosingClsName);
            if (clsInfo?.superClassName) {
                const superCls = superClass(clsInfo, fileModules);
                const ctor = findConstructorInHierarchy(superCls, fileModules);
                if (ctor) return { status: 'resolved', target: ctor };
            }
        }
        return { status: 'unresolved', reason: 'unresolved_super_ctor' };
    }

    return { status: 'unresolved', reason: 'unknown_kind' };
}

function analyze(source) {
    const key = sha256(source);
    if (analyzeCache.has(key)) return analyzeCache.get(key);

    const parsed = parseFile({name: 'inline.js', source, role: 'work'});
    const calls = new Set();
    for (const call of parsed.calls) {
        const name = call.calleeName ?? (call.receiverName ? `${call.receiverName}.${call.propertyName}` : call.propertyName);
        if (name) calls.add(name);
    }
    const methods = [...parsed.methods.values()].map(m => ({
        name: m.name,
        source: m.source,
        calls: m.calls.map(c => c.calleeName ?? c.propertyName).filter(Boolean),
        digest: m.digest
    }));

    const result = {calls: [...calls], methods};
    if (analyzeCache.size >= 2048) analyzeCache.delete(analyzeCache.keys().next().value);
    analyzeCache.set(key, result);
    return result;
}

function reachableContext(sources) {
    const contextSources = sources.filter(s => s.role === 'context');
    if (!contextSources.length && !sources.some(source => source.origin)) return [];

    const fileModules = new Map();
    const allCommands = new Map();
    const allTasks = new Map();

    for (const s of sources) {
        const parsed = parseFile(s);
        fileModules.set(s.name, parsed);
        for (const [cmd, info] of parsed.commands.entries()) allCommands.set(cmd, allCommands.has(cmd) ? null : info);
        for (const [task, info] of parsed.tasks.entries()) allTasks.set(task, allTasks.has(task) ? null : info);
    }

    const pendingCalls = [];
    for (const s of sources.filter(s => s.role !== 'context')) {
        const mod = fileModules.get(s.name);
        if (!s.origin) {
            if (mod) pendingCalls.push(...mod.calls);
            continue;
        }
        const {file} = s.origin;
        const original = fileModules.get(file);
        const ranges = s.origin.ranges ?? [s.origin];
        if (original?.role !== 'context' || !Array.isArray(ranges) || !ranges.length ||
            ranges.some(range => !range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
                range.start < 0 || range.end <= range.start || range.end > original.source.length ||
                !s.source.includes(original.source.slice(range.start,range.end)))) {
            throw new EstimationError([{phase: 'predictor', message: 'Invalid detached source origin: ' + s.name}]);
        }
        for (const call of original.calls) {
            const owner = call.enclosing?.node;
            if (ranges.some(({start,end}) => call.node.start >= start && call.node.end <= end &&
                (!owner || owner.start <= start || owner.end > end))) pendingCalls.push(call);
        }
    }

    const selectedMethods = new Map();
    const traversedImplementations = new Map();
    const resolvedEdges = [];
    const unknownEdges = [];
    const callSiteCounts = new Map();
    const visitedCallNodes = new Map();
    const countedCallTargets = new Map();
    function alreadyVisited(map, item, process) {
        if (!map.has(item)) map.set(item,new Set());
        const processes = map.get(item);
        if (processes.has(process)) return true;
        processes.add(process);
        return false;
    }

    while (pendingCalls.length) {
        const call = pendingCalls.pop();
        if (call.node && alreadyVisited(visitedCallNodes,call.node,call.process)) continue;

        const res = resolveCall(call, fileModules, allCommands, allTasks);
        if (res.status === 'builtin' || res.status === 'cypress_builtin') {
            continue;
        }

        let targetMethod = null;
        if (res.status === 'resolved') {
            targetMethod = res.target;
        } else if (res.status === 'resolved_class') {
            targetMethod = findConstructorInHierarchy(res.clsInfo, fileModules);
        }

        if (targetMethod) {
            const registeredProcess = targetMethod.taskName ? 'runner' : targetMethod.commandName ? 'browser' : undefined;
            const process = registeredProcess ?? call.process;
            if (!alreadyVisited(countedCallTargets,call.node,targetMethod.digest))
                callSiteCounts.set(targetMethod.digest, (callSiteCounts.get(targetMethod.digest) || 0) + 1);
            resolvedEdges.push({
                from: call.fileName,
                to: targetMethod.file,
                targetId: targetMethod.id,
                callee: call.calleeName ?? (call.receiverName ? `${call.receiverName}.${call.propertyName}` : call.propertyName),
                ...(process ? {process} : {}),
                ...(registeredProcess ? {registration:true} : {}),
                digest: targetMethod.digest
            });
            if (!selectedMethods.has(targetMethod.digest)) selectedMethods.set(targetMethod.digest, targetMethod);
            // Equal source bytes can close over different imports or lexical scopes.
            // Deduplicate emitted syntax separately from dependency traversal.
            if (!alreadyVisited(traversedImplementations,targetMethod,process)) {
                pendingCalls.push(...targetMethod.calls.map(child=>({...child,process})));
                if (targetMethod.isConstructor && targetMethod.className) {
                    const clsInfo = targetMethod.classInfo ?? findClassInModule(fileModules.get(targetMethod.file), targetMethod.className);
                    if (clsInfo?.superClassName) {
                        const superCls = superClass(clsInfo, fileModules);
                        const superCtor = findConstructorInHierarchy(superCls, fileModules);
                        if (superCtor && !alreadyVisited(traversedImplementations,superCtor,process)) {
                            if (!selectedMethods.has(superCtor.digest)) selectedMethods.set(superCtor.digest, superCtor);
                            pendingCalls.push(...superCtor.calls.map(child=>({...child,process})));
                        }
                    }
                }
            }
        } else if (res.status === 'unresolved') {
            unknownEdges.push({
                from: call.fileName,
                receiver: call.receiverName,
                property: call.propertyName,
                callee: call.calleeName,
                ...(res.taskName === undefined ? {} : {taskName:res.taskName}),
                ...(call.process ? {process:call.process} : {}),
                reason: res.reason
            });
        }
    }

    const result = [...selectedMethods.values()]
        .sort((a, b) => a.digest.localeCompare(b.digest))
        .map(method => ({
            name: 'reachable-' + method.digest + '.js',
            role: 'context',
            source: method.source
        }));

    result.unknownEdges = unknownEdges;
    result.unresolved = unknownEdges;
    result.edges = resolvedEdges;
    result.callSiteCounts = Object.fromEntries(callSiteCounts);
    result.graph = {
        resolvedCount: resolvedEdges.length,
        unresolvedCount: unknownEdges.length,
        selectedCount: result.length,
        edges: resolvedEdges,
        unknownEdges,
        callSiteCounts: Object.fromEntries(callSiteCounts)
    };

    return result;
}

function inspectReachability(sources) {
    const selected = reachableContext(sources);
    return {
        selected,
        graph: selected.graph,
        unknownEdges: selected.unknownEdges,
        edges: selected.edges,
        callSiteCounts: selected.callSiteCounts
    };
}

module.exports = {reachableContext, analyze, inspectReachability};
