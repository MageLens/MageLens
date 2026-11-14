// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {stripTypeScriptTypes} = require('node:module');
const {digest, fileDigest, Graph} = require('./engine.cjs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function compileFragment(parameters, code) {
    const strict = '"use strict";\n';
    try { return new AsyncFunction(...parameters, strict + code); }
    catch (original) {
        if (!(original instanceof SyntaxError)) throw original;
        try { return new AsyncFunction(...parameters, strict + stripTypeScriptTypes(code, {mode: 'transform'})); }
        catch (error) {
            if (error.code === 'ERR_NO_TYPESCRIPT') {
                original.message += '; TypeScript syntax requires the pinned runner Node build'; throw original;
            }
            throw error;
        }
    }
}

function verifySources(manifest) {
    require('./estimation.cjs').assertAssessed(manifest);
    try {
        const root = fs.realpathSync(manifest.root);
        for (const source of manifest.sources) {
            const file = path.resolve(root, source.path);
            if (!file.startsWith(root + path.sep) || fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) throw new Error('Source escapes the manifest root');
            if (fileDigest(file) !== source.sha256) throw new Error(`Stale source: ${source.path}; generate the manifest again`);
        }
        const discovery = manifest.assessment.discovery;
        if (discovery) {
            for (const {row} of discovery.tests) {
                if (row.files) require('./predictor/discovery-context.cjs').discoveryContext(row,
                    {root,dependencyRoots:discovery.dependencyRoots});
            }
        }
    } catch (error) {
        throw new (require('./estimation.cjs').EstimationError)([{phase: 'source', message: error.message}], error.message);
    }
}

function playwrightCoverageAdapter(manifest, expect) {
    const files = ['playwright/support.cjs', 'playwright/coverage-cookie.cjs',
        'playwright/javascript-coverage.cjs', 'bin/browser-navigation.cjs'];
    const expected = new Map(files.map(file => [file, fileDigest(path.resolve(__dirname, '..', file))]));
    const verified = new Set(manifest.sources.filter(source =>
        expected.get(source.path) === source.sha256).map(source => source.path));
    const fixtureReasons = new Set([
        'Custom fixture lifecycle is not equivalent to a bare page',
        'Project imports or custom fixtures require an execution adapter'
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
    const supports = test => test.fixture === './playwright/support.cjs:test' &&
        test.parameters === '( { page } )' && !test.restoration &&
        files.every(file => verified.has(file) && test.contextFiles.includes(file)) &&
        test.contextFiles.every(file => file === test.file || verified.has(file)) &&
        test.reasons.length === fixtureReasons.size && test.reasons.every(reason => fixtureReasons.has(reason)) &&
        test.steps.every(step => step.kind === 'statement' && step.portable) &&
        supportedImports(test.file) && supportedBindings(test);
    const tests = new Map(manifest.tests.map(test => [test.id, test]));
    const compiled = new Map();
    return {
        identity: digest([...expected]),
        supports,
        supportsCheckpoint: checkpoint => checkpoint.depth > 0 &&
            checkpoint.consumers.every(id => tests.has(id) && supports(tests.get(id))),
        execute(test, from, to, runtime) {
            const key = JSON.stringify([test.id, from, to]);
            if (!compiled.has(key)) {
                const bytes = fs.readFileSync(path.join(manifest.root, test.file));
                const code = test.steps.slice(from, to).map(step => bytes.subarray(step.start, step.end).toString('utf8')).join('\n');
                compiled.set(key, compileFragment(['page', 'expect'], code));
            }
            return compiled.get(key)(runtime.page, expect ?? require('@playwright/test').expect);
        }
    };
}

function buildWorkflow(manifest, configuration, selected) {
    verifySources(manifest);
    require('./estimation.cjs').assertExecutable(manifest);
    if (!configuration.identity || typeof configuration.state !== 'function' || typeof configuration.assertCheckpoint !== 'function') {
        throw new Error('Automatic runs require identity, state(runtime) and assertCheckpoint(runtime, checkpoint) in the project configuration');
    }
    const byId = new Map(manifest.tests.map(t => [t.id, t]));
    const selection = new Set(selected?.length ? selected : manifest.schedule);
    if (selected && selection.size !== selected.length) throw new Error('Duplicate test selection');
    for (const id of selection) if (!byId.has(id)) throw new Error(`Unknown test ${id}`);
    if (!selection.size) throw new Error('Empty test selection');
    const adapter = configuration.adapter;
    if (adapter && (typeof adapter.execute !== 'function' || typeof adapter.supports !== 'function' || !adapter.identity)) throw new Error('Adapter requires identity, supports(test) and execute(test, from, to, runtime)');
    for (const id of selection) {
        const t = byId.get(id);
        if (adapter ? adapter.supports(t) !== true : t.disposition !== 'automatic') {
            throw new Error(`${t.file}:${t.line} ${t.title}: ${t.reasons.join('; ')}. No test was launched.`);
        }
    }
    const usable = manifest.checkpoints.filter(c => c.consumers.filter(id => selection.has(id)).length >= 2 &&
        (c.automatic || (adapter?.supportsCheckpoint?.(c, byId.get(c.representative)) === true)));
    const fixtureState = !adapter && [...selection].some(id=>byId.get(id).restoration)
        ? new (require('./runners/playwright/fixture-state.cjs').FixtureState)(manifest, configuration) : undefined;
    const source = new Map(), compiled = new Map();
    const cypress = test => test.fixture?.startsWith('cypress:');
    const execute = (test, from, to, runtime, terminal = false) => {
        if (adapter) return adapter.execute(test, from, to, runtime);
        if (test.restoration) {
            if (!terminal && from===0 && to===0) return;
            if (!terminal || from!==0 || to!==test.steps.length) throw new Error('Fixture continuation requires a complete test body');
            return fixtureState.run(test,runtime);
        }
        const key = `${test.id}:${from}:${to}`;
        if (cypress(test)) {
            if (!source.has(test.file)) source.set(test.file, fs.readFileSync(path.join(manifest.root, test.file)));
            const original = source.get(test.file);
            return runtime.executeCypress(test.steps.slice(from, to).map(s => original.subarray(s.start, s.end).toString('utf8')).join('\n'));
        }
        if (!compiled.has(key)) {
            if (!source.has(test.file)) source.set(test.file, fs.readFileSync(path.join(manifest.root, test.file)));
            // Rust offsets are UTF-8 byte offsets, not JavaScript string indexes.
            const original = source.get(test.file);
            const code = test.steps.slice(from, to).map(s => original.subarray(s.start, s.end).toString('utf8')).join('\n');
            compiled.set(key, compileFragment(['page', 'expect'], code));
        }
        return compiled.get(key)(runtime.page, configuration.expect ?? require('@playwright/test').expect);
    };
    const roots = new Map();
    const stages = [];
    const predictions = manifest.assessment.stages;
    const fixtureCheckpointFor = test => manifest.checkpoints.find(checkpoint => checkpoint.depth === 0 && checkpoint.consumers.includes(test.id));
    const usableIds = new Set(usable.map(checkpoint => checkpoint.id));
    const duration = id => {
        const value = predictions[id]?.prediction?.ms;
        if (!Number.isFinite(value) || value < 0) throw new Error(`Missing ML stage prediction: ${id}`);
        return Math.ceil(value);
    };
    const rootFor = test => {
        // A fixture moved into a checkpoint must not share its empty root
        // with a test that still prepares its fixture in the root.
        const fixtureCheckpoint = !adapter && test.restoration ? fixtureCheckpointFor(test) : undefined;
        const checkpointOwnsSetup = usableIds.has(fixtureCheckpoint?.id);
        const key = `${test.scope}:${checkpointOwnsSetup}`;
        if (!roots.has(key)) {
            const forecastId = `root-${test.scope.slice(0, 20)}`;
            const id = checkpointOwnsSetup ? `${forecastId}-checkpoint` : forecastId;
            roots.set(key, id);
            stages.push({id, label: `Fixture · ${test.fixture}`, source: {file: test.file, line: test.line}, checkpoint: false, inputs: {scope: test.scope},
                estimatedMs: checkpointOwnsSetup ? 0 : duration(
                    fixtureCheckpoint && predictions[forecastId]?.empty ? fixtureCheckpoint.id : forecastId
                ),
                run: async runtime => {
                    if (checkpointOwnsSetup) return;
                    if (test.restoration && !adapter) await fixtureState.prepare(test,runtime);
                    else await adapter?.prepare?.(test, runtime);
                }, assert: async () => {}});
        }
        return roots.get(key);
    };
    const parentFor = (test, depth) => usable.filter(c => c.depth < depth && c.consumers.includes(test.id)).sort((a,b) => b.depth-a.depth)[0];
    for (const checkpoint of usable) {
        const test = byId.get(checkpoint.consumers.find(id => selection.has(id)));
        const parent = parentFor(test, checkpoint.depth);
        const boundary = test.steps[checkpoint.depth - 1];
        const forecast = predictions[checkpoint.id];
        const fromDepth = parent?.depth ?? 0;
        const forecastIdentity = (checkpoint.depth > 0 || (!adapter && test.restoration)) &&
            forecast?.segment?.representative === test.id &&
            forecast.segment.fromDepth === fromDepth && forecast.segment.toDepth === checkpoint.depth
            ? {digest:digest(forecast.trainingSnapshot ?? forecast),modelId:forecast.prediction.modelId,
                featureSchema:forecast.featureSchema,environmentDigest:forecast.environmentDigest,
                sourceDigest:forecast.sourceDigest,timingBoundary:forecast.timingBoundary}
            : null;
        stages.push({id: checkpoint.id, label: checkpoint.label ?? `Shared prefix · ${checkpoint.depth} steps`,
            source: {file: test.file, line: boundary?.line ?? test.line}, parent: parent?.id ?? rootFor(test),
            // Filtering native-only tests can change the representative or
            // ancestor. Keep that work in the graph, with an unknown cost.
            estimatedMs: forecast?.segment && !forecastIdentity ? null : duration(checkpoint.id),
            inputs: {checkpoint, source: manifest.sourceDigest, fromDepth, forecastIdentity},
            run: runtime => checkpoint.depth === 0 && test.restoration && !adapter
                ? fixtureState.prepare(test, runtime) : execute(test, fromDepth, checkpoint.depth, runtime),
            assert: runtime => configuration.assertCheckpoint(runtime, checkpoint)});
    }
    const specs = manifest.schedule.filter(id => selection.has(id)).map(id => {
        const test = byId.get(id), parent = parentFor(test, Infinity);
        return {id, label: test.title, source: {file: test.file, line: test.line}, parent: parent?.id ?? rootFor(test), inputs: {test: id, source: manifest.sourceDigest},
            run: runtime => execute(test, parent?.depth ?? 0, test.steps.length, runtime, true), assert: async () => {}};
    });
    // Compile all native fragments now: syntax failures must precede backend setup.
    if (!adapter) for (const test of manifest.tests.filter(t => selection.has(t.id))) {
        if(test.restoration)continue;
        const cuts = [0, ...usable.filter(c => c.consumers.includes(test.id)).map(c => c.depth).sort((a,b)=>a-b), test.steps.length];
        const original = fs.readFileSync(path.join(manifest.root, test.file));
        for (let i=1;i<cuts.length;i++) {
            const code = test.steps.slice(cuts[i-1], cuts[i]).map(s=>original.subarray(s.start,s.end).toString('utf8')).join('\n');
            compiled.set(`${test.id}:${cuts[i-1]}:${cuts[i]}`, compileFragment(cypress(test) ? ['cy','Cypress','expect'] : ['page','expect'],code));
        }
    }
    return {
        workflow: new Graph({runtimeState:fixtureState, costBaseline: configuration.costBaseline, maxCheckpointsPerTest: configuration.maxCheckpointsPerTest, identity: {source: manifest.sourceDigest, fixture: configuration.identity,
            configuration: {selection: [...selection].sort(), adapter: adapter?.identity ?? null,
                runnerOptions: digest(configuration.runnerOptions ?? {})},
            dependencies: configuration.dependencies ?? configuration.identity,
            implementation: digest([fileDigest(__filename), fileDigest(require.resolve('./engine.cjs')), manifest.implementation,
                ...(fixtureState?['./runtime-state.cjs','./runners/playwright/fixture-state.cjs','./runners/playwright/fixture-values.cjs'].map(file=>fileDigest(require.resolve(file))):[])])}, stages, specs}),
        state: configuration.state, checkpointLifetime: 'last-consumer', runnerOptions: configuration.runnerOptions
    };
}
module.exports = {buildWorkflow, verifySources, compileFragment, playwrightCoverageAdapter};
