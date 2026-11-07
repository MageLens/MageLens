// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path = require('node:path');
const {buildWorkflow, verifySources} = require('./automatic.cjs');
const costs = require('./costs.cjs');
function partition(manifest, inventory, project) {
    const dependencyProjects = new Set(inventory.config.projects.flatMap(p => p.dependencies ?? []));
    const setup = inventory.tests.filter(t => dependencyProjects.has(t.project));
    const main = inventory.tests.filter(t => !dependencyProjects.has(t.project));
    const occurrences = new Map();
    const key = test => `${path.resolve(test.file)}:${test.line}:${test.title}`;
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
async function runSuite(options) {
    costs.assertAutomatic(options);
    const {manifest, project, directory, runner, runCheckpoint} = options;
    costs.assertAutomatic(project);
    const mode = 'AUTO';
    verifySources(manifest);
    const started = performance.now(), phases = [], inventory = await runner.collect(project.native.config, directory);
    if (inventory.exitCode !== 0 || inventory.errors.length || !inventory.tests.length) throw new Error('Native collection failed or returned no tests');
    if (new Set(inventory.tests.map(t => t.id)).size !== inventory.tests.length) throw new Error('Native inventory has duplicate test identities');
    const groups = partition(manifest, inventory, project);
    let decision, plan, built, checkpoint = groups.checkpoint;
    const setupProjects = [...new Set(groups.setup.map(t => t.project))];
    const simpleDependencies = setupProjects.length === 1 && inventory.config.projects.every(p =>
        p.name === setupProjects[0] ? !p.dependencies?.length : p.dependencies?.length === 1 && p.dependencies[0] === setupProjects[0]);
    // Project teardown dependencies need one untouched native invocation.
    if (project.native.splitSafe !== true || !simpleDependencies || inventory.config.globalTeardown || inventory.config.webServer ||
        inventory.config.projects.some(p => p.teardown)) checkpoint = [];
    if (checkpoint.length) {
        built = buildWorkflow(manifest, project, checkpoint.map(t => t.staticId));
        ({plan, decision} = costs.planWorkflow(built.workflow));
        const chosen = new Set(decision.selected);
        const byStaticId = new Map(checkpoint.map(test => [test.staticId, test]));
        checkpoint = built.workflow.select().filter(test => built.workflow.chain(test.parent)
            .some(stage => chosen.has(stage.id))).map(test => byStaticId.get(test.id));
    }

    const report = {schemaVersion: 1, kind: 'full-native-suite', mode, inventory: inventory.tests, sourceDigest: manifest.sourceDigest,
        setupDiagnostics: {nativeCollectionMs: inventory.wallMs},
        diagnostics: manifest.diagnostics, decision, phases, results: [], checkpoints: 0, reuseHits: 0, status: 'failed',
        routing: {checkpoint: checkpoint.map(t => t.id), native: inventory.tests.filter(t => !checkpoint.some(c => c.id === t.id)).map(t => t.id)}};
    async function native(tests, options = {}) {
        const result = await runner.run(project.native.config, directory, {...options, ...(tests ? {tests} : {})});
        validateNative(result, tests ?? inventory.tests); phases.push({kind: 'native', ...result}); report.results.push(...result.results.map(r => ({...r, execution: 'native'}))); return result;
    }
    if (!checkpoint.length) {
        report.selectionReason = decision ? 'Static cost model selected native execution for the complete suite.' : 'No qualified split; execute the complete native suite.';
        await native();
    } else {
        if (!groups.setup.length) throw new Error('A mixed suite requires an explicit native setup project to own global setup before checkpoints');
        const setup = await native(groups.setup, {teardown: false});
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
    report.wallMs = performance.now() - started;
    return report;
}
module.exports = {partition, validateNative, runSuite};
