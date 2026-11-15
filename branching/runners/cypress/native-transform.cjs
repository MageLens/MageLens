// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {createHash} = require('node:crypto');
const hash = source => createHash('sha256').update(source).digest('hex');

// Entries use the planner's UTF-8 byte ranges. The transform runs before the
// project's compiler and retains its source map and original module graph.
function transform(source, filename, entries, browserState, stateAccess = []) {
    if (!entries.length) return {code: source, map: null};
    if (entries.some(entry => entry.sha256 !== hash(source))) throw new Error('Native checkpoint source changed');
    const used = new Set();
    const access = require('./native-state-transform.cjs').instrument(source,stateAccess);
    const result = require('@babel/core').transformSync(source, {
        filename, sourceMaps: true, sourceFileName: filename, configFile: false, babelrc: false,
        parserOpts: {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']},
        plugins: [({types: t}) => ({visitor: {Program: {exit(p) {
            p.unshiftContainer('body', t.expressionStatement(t.callExpression(t.memberExpression(
                t.callExpression(t.identifier('require'), [t.stringLiteral(require.resolve('./native-boundary.cjs'))]),
                t.identifier('install')), browserState ? [t.callExpression(t.identifier('require'), [t.stringLiteral(browserState)])] : [])));
        }}, Function(p) {
            const start = Buffer.byteLength(source.slice(0, p.node.start));
            const end = Buffer.byteLength(source.slice(0, p.node.end));
            const matching = entries.filter(entry => entry.callbackStart === start && entry.callbackEnd === end);
            if (!matching.length) return;
            if (matching.length !== 1) throw new Error('Overlapping native checkpoint callbacks');
            const entry = matching[0], body = p.get('body');
            if (!body.isBlockStatement() || p.node.async || p.node.generator || p.node.params.length)
                throw new Error('Native checkpoint requires a synchronous Cypress callback without parameters');
            const statements = body.get('body');
            const cut = statements.findIndex(statement => Buffer.byteLength(source.slice(0, statement.node.end)) === entry.end) + 1;
            if (!cut || cut >= statements.length || Buffer.byteLength(source.slice(0, statements[0].node.start)) !== entry.start)
                throw new Error('Native checkpoint is not an initial statement boundary');
            const prefix = statements.slice(0, cut);
            const inputs = new Map();
            const include = reference => {
                const binding = reference.scope.getBinding(reference.node.name);
                if (!binding) return;
                // All original declarations remain in their original scope.
                // Their values are read when the queued boundary starts, after
                // the original callback has finished enqueuing its work.
                if (binding.scope === p.scope || binding.path.node.end <= p.node.start || binding.path.node.start >= p.node.end)
                    inputs.set(reference.node.name, t.identifier(reference.node.name));
            };
            let context = false;
            for (const statement of prefix) {
                if (!statement.isExpressionStatement() && !statement.isVariableDeclaration())
                    throw new Error('Native checkpoint requires an unconditional statement boundary');
                statement.traverse({ReferencedIdentifier: include,
                    ThisExpression() { context = true; },
                    AwaitExpression() { throw new Error('Native checkpoint has an unsupported continuation'); },
                    YieldExpression() { throw new Error('Native checkpoint has an unsupported continuation'); }
                });
                if (statement.isVariableDeclaration()) for (const declaration of statement.get('declarations')) {
                    for (const name of Object.keys(t.getBindingIdentifiers(declaration.node.id))) inputs.set(name, t.identifier(name));
                }
            }
            if (context) inputs.set('callbackContext', t.thisExpression());
            const reader = t.arrowFunctionExpression([], t.objectExpression([...inputs].sort(([a],[b])=>a.localeCompare(b))
                .map(([name,value])=>t.objectProperty(t.identifier(name),value))));
            const runtime = method => t.memberExpression(t.callExpression(t.identifier('require'),
                [t.stringLiteral(require.resolve('./native-boundary.cjs'))]), t.identifier(method));
            const token = p.scope.generateUidIdentifier('checkpoint');
            const begin = t.variableDeclaration('const', [t.variableDeclarator(token, t.callExpression(runtime('begin'), [
                t.stringLiteral(entry.checkpoint), t.stringLiteral(entry.consumer), reader]))]);
            const endMarker = t.expressionStatement(t.callExpression(runtime('end'), [token]));
            body.node.body = [begin, ...prefix.map(statement=>statement.node), endMarker, ...statements.slice(cut).map(statement=>statement.node)];
            used.add(entry); p.skip();
        }}}),access.plugin]
    });
    access.check();
    if (used.size !== entries.length) throw new Error('Native checkpoint callback identity was not found');
    return {code: result.code, map: result.map};
}
module.exports = {transform};
