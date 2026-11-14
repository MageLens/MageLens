// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path = require('node:path');
const {buildWorkflow, verifySources} = require('./automatic.cjs');
const costs = require('./costs.cjs');
const {EstimationError} = require('./estimation.cjs');
const {SEGMENT_TIMING_BOUNDARY, observeExecutedSegment} = require('./predictor/prefix-measurement.cjs');
const {digest} = require('./identity.cjs');
const testKey = test => `${path.resolve(test.file)}:${test.framework === 'cypress' || test.fixture?.startsWith('cypress:') ? 'cypress' : test.line}:${test.title}`;

function segmentEvidence(manifest, phases, suitePassed) {
    const snapshots = new Map(Object.entries(manifest.assessment.stages)
        .flatMap(([id, stage]) => stage.trainingSnapshot ? [[id, {
            value:stage.trainingSnapshot, digest:digest(stage.trainingSnapshot)
        }]] : []));
    return phases.filter(phase => phase.kind === 'checkpoint').flatMap(({report}) =>
        (report.segments ?? []).filter(segment => segment.prefixTiming).map(segment => {
            const snapshot = snapshots.get(segment.node);
            const matched = snapshot && snapshot.digest === segment.prefixTiming.forecast?.digest;
            const retained = report.providerDiagnostics?.retainedServices;
            const audited = suitePassed && report.status === 'passed' && report.counts.fallbacks === 0 &&
                !report.errors?.length && retained?.schemasRemoved === true && retained?.grantsRestored === true;
            const observation = matched ? observeExecutedSegment(snapshot.value, segment, {
                passed:audited, attempts:1, sourceDigest:snapshot.value.sourceDigest
            }) : null;
            return {
                segmentId:segment.id,
                stageId:segment.node,
                snapshotDigest:matched ? snapshot.digest : null,
                sourceVerified:true,
                providerAuditPassed:audited,
                observation
            };
        }));
}
function assertInventoryAssessed(manifest, inventory) {
    const lifecycle = [...(inventory.config.unassessedLifecycle ?? []),
        ...['globalSetup', 'globalTeardown', 'webServer'].filter(key => inventory.config[key])];
    if (lifecycle.length) throw new EstimationError(lifecycle.map(name => ({phase: 'native-lifecycle',
        message: `${name} is not covered by the source assessment. Move test work into assessed spec hooks or fixtures before using branching.`})));
    const assessed = new Map();
    for (const test of manifest.tests) {
        const key = testKey({...test, file: path.join(manifest.root, test.file)});
        assessed.set(key, (assessed.get(key) ?? 0) + 1);
    }
    const perProject = new Map(), issues = [];
    for (const test of inventory.tests) {
        const key = testKey(test), occurrence = `${test.project}:${key}`;
        const count = (perProject.get(occurrence) ?? 0) + 1;
        perProject.set(occurrence, count);
        if (count > (assessed.get(key) ?? 0)) issues.push({phase: 'native-collection', file: test.file, line: test.line, test: test.title,
            message: 'Native test has no corresponding complete source assessment'});
    }
    if (issues.length) throw new EstimationError(issues);
}
function partition(manifest, inventory, project) {
    const dependencyProjects = new Set(inventory.config.projects.flatMap(p => p.dependencies ?? []));
    const setup = inventory.tests.filter(t => dependencyProjects.has(t.project));
    const main = inventory.tests.filter(t => !dependencyProjects.has(t.project));
    const occurrences = new Map();
    const key = testKey;
    for (const test of main) occurrences.set(key(test), (occurrences.get(key(test)) ?? 0) + 1);
    const staticTests = new Map(manifest.tests.map(test => [key({...test, file: path.join(manifest.root, test.file)}), test]));
    const checkpoint = [], native = [];
    for (const test of main) {
        const candidate = staticTests.get(key(test));
        const eligible = occurrences.get(key(test)) === 1 && test.expectedStatus === 'passed' &&
            !test.annotations?.some(a => ['skip', 'fixme', 'fail'].includes(a.type)) && candidate &&
            (project.adapter ? project.adapter.supports(candidate) === true : candidate.disposition === 'automatic');
        (eligible ? checkpoint : native).push(eligible ? {...test, staticId: candidate.id} : test);
    }
    return {setup, checkpoint, native};
}
function validateNative(report, expected) {
    const actual = report.tests.map(t => t.id).sort(), wanted = expected.map(t => t.id).sort();
    if (new Set(actual).size !== actual.length || JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error('Native selection changed: refusing missing, extra or duplicated tests');
    if (new Set(report.results.map(t => t.id)).size !== report.results.length) throw new Error('Duplicate native results');
    if (report.results.some(t => !wanted.includes(t.id))) throw new Error('Native runner returned an unselected result');
    if (report.exitCode === 0 && (report.status !== 'passed' || JSON.stringify(report.results.map(t => t.id).sort()) !== JSON.stringify(wanted))) {
        throw new Error('Native runner claimed success with incomplete results');
    }
}
async function collectAssessed(manifest, project, directory, runner) {
    verifySources(manifest);
    require('./estimation.cjs').assertExecutable(manifest);
    if (!project.native?.config) throw new EstimationError([{phase: 'native-collection', message: 'A native runner configuration is required to assess the complete inventory and lifecycle'}]);
    let inventory;
    try { inventory = await runner.collect(project.native.config, directory); }
    catch (error) { throw new EstimationError([{phase: 'native-collection', message: error.message}]); }
    if (inventory.exitCode !== 0 || inventory.errors.length || !inventory.tests.length)
        throw new EstimationError([{phase: 'native-collection', message: 'Native collection failed or returned no tests', reasons: inventory.errors}]);
    if (new Set(inventory.tests.map(t => t.id)).size !== inventory.tests.length)
        throw new EstimationError([{phase: 'native-collection', message: 'Native inventory has duplicate test identities'}]);
    assertInventoryAssessed(manifest, inventory);
    return inventory;
}
async function runSuite(options) {
    costs.assertAutomatic(options);
    const {manifest, project, directory, runner, runCheckpoint} = options;
    costs.assertAutomatic(project);
    require('./checkpoint-limit.cjs').validateLimit(project.maxCheckpointsPerTest);
    const mode = 'AUTO';
    const started = performance.now(), phases = [];
    const inventory = await collectAssessed(manifest, project, directory, runner);
    const groups = partition(manifest, inventory, project);
    let decision, plan, built, checkpoint = groups.checkpoint;
    const setupProjects = [...new Set(groups.setup.map(t => t.project))];
    const simpleDependencies = setupProjects.length === 1 && inventory.config.projects.every(p =>
        p.name === setupProjects[0] ? !p.dependencies?.length : p.dependencies?.length === 1 && p.dependencies[0] === setupProjects[0]);
    const independent = inventory.config.checkpointLifecycle === 'independent-cypress';
    // Project teardown dependencies need one untouched native invocation.
    if (project.native.splitSafe !== true || (!simpleDependencies && !independent) || inventory.config.globalTeardown || inventory.config.webServer ||
        inventory.config.projects.some(p => p.teardown)) checkpoint = [];
    if (checkpoint.length) {
        built = buildWorkflow(manifest, independent ? {...project, runnerOptions: {...project.runnerOptions, nativeConfig: project.native.config}} : project, checkpoint.map(t => t.staticId));
        ({plan, decision} = costs.planWorkflow(built.workflow));
        const chosen = new Set(decision.selected);
        const byStaticId = new Map(checkpoint.map(test => [test.staticId, test]));
        checkpoint = built.workflow.select().filter(test => built.workflow.chain(test.parent)
            .some(stage => chosen.has(stage.id))).map(test => byStaticId.get(test.id));
    }

    const report = {schemaVersion: 1, kind: 'full-native-suite', mode, inventory: inventory.tests, sourceDigest: manifest.sourceDigest,
        setupDiagnostics: {nativeCollectionMs: inventory.wallMs},
        diagnostics: manifest.diagnostics, assessment: manifest.assessment, decision, phases, results: [], checkpoints: 0, reuseHits: 0, status: 'failed',
        routing: {checkpoint: checkpoint.map(t => t.id), native: inventory.tests.filter(t => !checkpoint.some(c => c.id === t.id)).map(t => t.id)}};
    async function native(tests, options = {}) {
        const result = await runner.run(project.native.config, directory, {...options, ...(tests ? {tests} : {})});
        validateNative(result, tests ?? inventory.tests); phases.push({kind: 'native', ...result}); report.results.push(...result.results.map(r => ({...r, execution: 'native'}))); return result;
    }
    if (!checkpoint.length) {
        report.selectionReason = decision ? 'ML duration model selected native execution for the complete suite.' : 'No qualified split; execute the complete native suite.';
        await native();
    } else {
        if (!groups.setup.length && !independent) throw new Error('A mixed suite requires an explicit native setup project to own global setup before checkpoints');
        const setup = groups.setup.length ? await native(groups.setup, {teardown: false}) : {exitCode: 0, status: 'passed', results: []};
        if (setup.exitCode === 0 && setup.status === 'passed' && setup.results.every(r => r.status === 'passed')) {
            verifySources(manifest);
            const result = await runCheckpoint({...built, specs: checkpoint.map(t => t.staticId), plan}, decision);
            phases.push({kind: 'checkpoint', report: result});
            const byId = new Map(checkpoint.map(t => [t.staticId, t]));
            for (const entry of result.results) {
                const source = byId.get(entry.spec);
                if (!source) throw new Error('Checkpoint worker returned an unselected test');
                report.results.push({id: source.id, status: entry.status, execution: 'checkpoint', original: entry});
            }
            report.checkpoints = result.checkpoints.length; report.reuseHits = result.counts.reuseHits;
            const remaining = inventory.tests.filter(test => !groups.setup.some(s => s.id === test.id) && !checkpoint.some(c => c.id === test.id));
            if (remaining.length) await native(remaining, {setup: false});
        }
    }
    verifySources(manifest);
    const actual = report.results.map(t => t.id), expected = inventory.tests.map(t => t.id);
    report.missing = expected.filter(id => !actual.includes(id));
    report.duplicates = actual.filter((id, index) => actual.indexOf(id) !== index);
    report.skipped = report.results.filter(t => t.status === 'skipped').map(t => t.id);
    report.status = !report.missing.length && !report.duplicates.length && phases.every(p => p.kind === 'native' ? p.status === 'passed' && p.exitCode === 0 && !p.errors.length : p.report.status === 'passed') ? 'passed' : 'failed';
    if (report.results.some(r => !['passed', 'skipped'].includes(r.status))) report.status = 'failed';
    if (report.status === 'passed' && report.skipped.length) report.status = 'completed-with-skips';
    if (manifest.assessment.prefixTimingBoundary === SEGMENT_TIMING_BOUNDARY)
        report.prefixEvidence = segmentEvidence(manifest, phases, report.status === 'passed');
    report.wallMs = performance.now() - started;
    return report;
}
module.exports = {partition, validateNative, collectAssessed, runSuite};
