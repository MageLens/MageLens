// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {digest, fileDigest, Graph} = require('./engine.cjs');
const {compileFragment, fragments} = require('./fragments.cjs');
const {playwrightCoverageAdapter} = require('./runners/playwright/coverage-adapter.cjs');

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
                if (row.files) require('./discovery-context.cjs').discoveryContext(row,
                    {root,dependencyRoots:discovery.dependencyRoots});
            }
        }
    } catch (error) {
        throw new (require('./estimation.cjs').EstimationError)([{phase: 'source', message: error.message}], error.message);
    }
}


function buildWorkflow(manifest, configuration, selected, boundaries) {
    verifySources(manifest);
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
    let usable = manifest.checkpoints.filter(c => c.consumers.filter(id => selection.has(id)).length >= 2 &&
        (c.automatic || (adapter?.supportsCheckpoint?.(c, byId.get(c.representative)) === true)));
    if (boundaries) {
        const known = new Set(usable.map(checkpoint=>checkpoint.id));
        if (boundaries.some(id=>!known.has(id))) throw new Error('Unknown measured checkpoint boundary');
        usable = usable.filter(checkpoint=>boundaries.includes(checkpoint.id));
    }
    const fixtureState = !adapter && [...selection].some(id=>byId.get(id).restoration)
        ? new (require('./runners/playwright/fixture-state.cjs').FixtureState)(manifest, configuration) : undefined;
    const prepared = fragments(manifest);
    const cypress = test => test.fixture?.startsWith('cypress:');
    const execute = (test, from, to, runtime, terminal = false) => {
        if (adapter) return adapter.execute(test, from, to, runtime);
        if (test.restoration) {
            if (!terminal && from===0 && to===0) return;
            if (!terminal || from!==0 || to!==test.steps.length) throw new Error('Fixture continuation requires a complete test body');
            return fixtureState.run(test,runtime);
        }
        if (cypress(test)) return runtime.executeCypress(prepared.source(test, from, to));
        return prepared.execute(test, from, to, runtime, configuration.expect);

    };
    const roots = new Map();
    const stages = [];
    const fixtureCheckpointFor = test => manifest.checkpoints.find(checkpoint => checkpoint.depth === 0 && checkpoint.consumers.includes(test.id));
    const usableIds = new Set(usable.map(checkpoint => checkpoint.id));
    const rootFor = test => {
        // A fixture moved into a checkpoint must not share its empty root
        // with a test that still prepares its fixture in the root.
        const fixtureCheckpoint = !adapter && test.restoration ? fixtureCheckpointFor(test) : undefined;
        const checkpointOwnsSetup = usableIds.has(fixtureCheckpoint?.id);
        const key = `${test.scope}:${checkpointOwnsSetup}`;
        if (!roots.has(key)) {
            const rootId = `root-${test.scope.slice(0, 20)}`;
            const id = checkpointOwnsSetup ? `${rootId}-checkpoint` : rootId;
            roots.set(key, id);
            stages.push({id, label: `Fixture · ${test.fixture}`, source: {file: test.file, line: test.line}, checkpoint: false, inputs: {scope: test.scope, rootId},
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
        const fromDepth = parent?.depth ?? 0;
        stages.push({id: checkpoint.id, label: checkpoint.label ?? `Shared prefix · ${checkpoint.depth} steps`,
            source: {file: test.file, line: boundary?.line ?? test.line}, parent: parent?.id ?? rootFor(test),
            inputs: {checkpoint, source: manifest.sourceDigest, fromDepth},
            run: runtime => checkpoint.depth === 0 && test.restoration && !adapter
                ? fixtureState.prepare(test, runtime) : execute(test, fromDepth, checkpoint.depth, runtime),
            assert: runtime => configuration.assertCheckpoint(runtime, checkpoint)});
    }
    const specs = (selected ?? manifest.schedule).filter(id => selection.has(id)).map(id => {
        const test = byId.get(id), parent = parentFor(test, Infinity);
        return {id, label: test.title, source: {file: test.file, line: test.line}, parent: parent?.id ?? rootFor(test), inputs: {test: id, source: manifest.sourceDigest},
            run: runtime => execute(test, parent?.depth ?? 0, test.steps.length, runtime, true), assert: async () => {}};
    });
    // Both built-in paths compile before any backend preparation or test execution.
    for (const test of manifest.tests.filter(t => selection.has(t.id))) {
        if (test.restoration && !adapter) continue;
        const cuts = [0, ...usable.filter(c => c.consumers.includes(test.id)).map(c => c.depth).sort((a,b)=>a-b), test.steps.length];
        if (adapter) adapter.prepareFragments?.(test, cuts);
        else prepared.prepare(test, cuts, cypress(test) ? ['cy','Cypress','expect'] : ['page','expect']);
    }

    return {
        workflow: new Graph({nativePageLifecycle:adapter?.nativePageLifecycle === true, runtimeState:fixtureState, costBaseline: configuration.costBaseline, costStatistics: configuration.costStatistics, maxCheckpointsPerTest: configuration.maxCheckpointsPerTest, identity: {source: manifest.sourceDigest, fixture: configuration.identity,
            configuration: {selection: [...selection].sort(), adapter: adapter?.identity ?? null,
                runnerOptions: digest(configuration.runnerOptions ?? {})},
            dependencies: configuration.dependencies ?? configuration.identity,
            implementation: digest([fileDigest(__filename), fileDigest(require.resolve('./fragments.cjs')), fileDigest(require.resolve('./engine.cjs')), manifest.implementation,
                ...(fixtureState?['./runtime-state.cjs','./runners/playwright/fixture-state.cjs','./runners/playwright/fixture-values.cjs'].map(file=>fileDigest(require.resolve(file))):[])])}, stages, specs}),
        state: configuration.state, checkpointLifetime: 'last-consumer', runnerOptions: configuration.runnerOptions
    };
}
module.exports = {buildWorkflow, verifySources, compileFragment, playwrightCoverageAdapter};
