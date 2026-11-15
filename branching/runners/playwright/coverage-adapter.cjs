// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {digest,fileDigest} = require('../../identity.cjs');
const {fragments} = require('../../fragments.cjs');

function playwrightCoverageAdapter(manifest, expect) {
    const files = ['playwright/support.cjs', 'playwright/coverage-cookie.cjs',
        'playwright/javascript-coverage.cjs', 'bin/browser-navigation.cjs'];
    const expected = new Map(files.map(file => [file, fileDigest(path.resolve(__dirname, '../../..', file))]));
    const verified = new Set(manifest.sources.filter(source =>
        expected.get(source.path) === source.sha256).map(source => source.path));
    const fixtureReasons = new Set([
        'custom-fixture',
        'project-imports'
    ]);
    const imports = new Map();
    function supportedImports(file) {
        if (!imports.has(file)) {
            const source = fs.readFileSync(path.join(manifest.root, file), 'utf8');
            const ast = require('@babel/parser').parse(source, {sourceType: 'module', plugins: ['typescript']});
            const declarations = ast.program.body.filter(node => node.type === 'ImportDeclaration');
            imports.set(file, declarations.length === 1 && declarations[0].source.value === './playwright/support.cjs' &&
                declarations[0].specifiers.length === 2 && ['test', 'expect'].every(name =>
                    declarations[0].specifiers.some(specifier => specifier.type === 'ImportSpecifier' &&
                        specifier.imported.name === name && specifier.local.name === name)));
        }
        return imports.get(file);
    }
    const checkedBodies = new Map();
    function supportedBindings(test) {
        if (!checkedBodies.has(test.id)) {
            const source = fs.readFileSync(path.join(manifest.root, test.file));
            const body = test.steps.map(step => source.subarray(step.start, step.end).toString('utf8')).join('\n');
            const ast = require('@babel/parser').parse(`async function fragment(page, expect) {\n${body}\n}`,
                {sourceType: 'module', plugins: ['typescript']});
            let supported = true;
            require('@babel/traverse').default(ast, {
                ReferencedIdentifier(identifier) {
                    if (!identifier.scope.hasBinding(identifier.node.name, {noGlobals: true})) supported = false;
                }
            });
            checkedBodies.set(test.id, supported);
        }
        return checkedBodies.get(test.id);
    }
    const independentPage = test => test.fixture === './playwright/support.cjs:test' &&
        test.parameters === '( { page } )' && !test.restoration &&
        files.every(file => verified.has(file) && test.contextFiles.includes(file)) &&
        test.contextFiles.every(file => file === test.file || verified.has(file)) &&
        test.reasonCodes?.length === fixtureReasons.size && test.reasonCodes.every(code => fixtureReasons.has(code)) &&
        test.steps.every(step => step.kind === 'statement') &&
        supportedImports(test.file) && supportedBindings(test);
    const supports = test => independentPage(test) && test.steps.every(step => step.portable);
    const tests = new Map(manifest.tests.map(test => [test.id, test]));
    const prepared = fragments(manifest);
    return {
        identity: digest([...expected, fileDigest(__filename), fileDigest(require.resolve('../../fragments.cjs'))]),
        nativePageLifecycle: true,
        supports,
        // Whole-test locals can prevent checkpoint splitting without changing
        // the isolated page lifecycle of an explicitly parallel native test.
        supportsOrdering: independentPage,
        supportsCheckpoint: checkpoint => checkpoint.depth > 0 &&
            checkpoint.consumers.every(id => tests.has(id) && supports(tests.get(id))),
        prepareFragments: prepared.prepare,
        execute(test, from, to, runtime) {
            return prepared.execute(test,from,to,runtime,expect);
        }
    };
}
module.exports = {playwrightCoverageAdapter};
