// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path = require('node:path');
const {buildWorkflow, verifySources} = require('./automatic.cjs');
const costs = require('./costs.cjs');
const {EstimationError} = require('./estimation.cjs');
const testKey = test => `${path.resolve(test.file)}:${test.framework === 'cypress' || test.fixture?.startsWith('cypress:') ? 'cypress' : test.line}:${test.title}`;

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
        const eligible = occurrences.get(key(test)) === 1 && test.expectedStatus === 'passed' && !test.serial &&
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
function playwrightCoverageResult(report, runId, browserVersion) {
    if (report.status !== 'passed' || !report.inventory.length ||
        report.results.length !== report.inventory.length || !/^[a-f0-9]{32}$/.test(runId) || !browserVersion)
        throw new Error('Playwright coverage requires a complete successful suite and a matching run');
    const results = new Map(report.results.map(result => [result.id, result]));
    const browser = {name: 'chrome', version: browserVersion};
    const tests = report.inventory.map(test => {
        const result = results.get(test.id);
        if (result?.status !== 'passed') throw new Error('Playwright coverage suite result is missing or failed');
        if (result.execution === 'native') {
            const identity = result.annotations?.find(annotation => annotation.type === 'magelens-browser');
            const actual = identity && JSON.parse(identity.description);
            if (actual?.name !== browser.name || actual.version !== browserVersion || result.attempts !== 1)
                throw new Error('Invalid native Playwright browser or attempt evidence');
        } else if (result.execution !== 'checkpoint') {
            throw new Error('Unknown Playwright execution phase');
        }
        return {title: test.title, status: result.status};
    });
    if (new Set(report.inventory.map(test => test.id)).size !== results.size ||
        results.size !== report.results.length) throw new Error('Duplicate Playwright test identities');
    for (const phase of report.phases.filter(phase => phase.kind === 'checkpoint')) {
        const actual = phase.report.browser;
        if (actual?.name !== 'Chrome for Testing' || actual.version !== browserVersion ||
            phase.report.counts.fallbacks !== 0) throw new Error('Invalid checkpoint Playwright browser or restore evidence');
    }
    return {run: runId, runner: 'playwright', status: 'passed', browser, totalTests: tests.length,
        totalPassed: tests.length, totalFailed: 0, totalPending: 0, totalSkipped: 0, maxAttempts: 1,
        specs: [...new Set(report.inventory.map(test => test.file))].sort(), tests};
}
async function collectAssessed(manifest, project, directory, runner) {
    verifySources(manifest);
    // Native inventory and lifecycle checks remain independent of timing.
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
async function prepareSuite(options) {
    costs.assertAutomatic(options);
    const {manifest, project, directory, runner, coverageRoot} = options;
    costs.assertAutomatic(project);
    require('./checkpoint-limit.cjs').validateLimit(project.maxCheckpointsPerTest);
    const inventory = await collectAssessed(manifest, project, directory, runner);
    const groups = partition(manifest, inventory, project);
    let decision, built, checkpoint = groups.checkpoint;
    const browserIneligible = [];
    const setupProjects = [...new Set(groups.setup.map(t => t.project))];
    const simpleDependencies = setupProjects.length === 1 && inventory.config.projects.every(p =>
        p.name === setupProjects[0] ? !p.dependencies?.length : p.dependencies?.length === 1 && p.dependencies[0] === setupProjects[0]);
    const independentCypress = inventory.config.checkpointLifecycle === 'independent-cypress';
    const independent = independentCypress || inventory.config.projects.length === 1 &&
        !inventory.config.projects[0].dependencies?.length && !inventory.config.globalSetup &&
        !inventory.config.globalTeardown && !inventory.config.webServer;
    // Project teardown dependencies need one untouched native invocation.
    if (inventory.tests.some(test => test.serial) || project.native.splitSafe !== true || (!simpleDependencies && !independent) || inventory.config.globalTeardown || inventory.config.webServer ||
        inventory.config.projects.some(p => p.teardown)) checkpoint = [];
    if (coverageRoot && checkpoint.length) {
        const {browserProfile} = require('./runners/playwright/native-reporter.cjs');
        const expected = browserProfile({channel: 'chrome', baseURL: process.env.PLAYWRIGHT_BASE_URL,
            ignoreHTTPSErrors: true, ...project.runnerOptions?.contextOptions, serviceWorkers: 'block'});
        const projects = new Map(inventory.config.projects.map(p => [p.name, p]));
        checkpoint = checkpoint.filter(test => {
            const profile = projects.get(test.project)?.browserProfile;
            const compatible = !Object.keys(project.runnerOptions?.launchOptions ?? {}).length &&
                expected.portable && profile?.portable && profile.digest === expected.digest;
            if (!compatible) browserIneligible.push({id: test.id, reason: 'incompatible-playwright-browser-settings'});
            return compatible;
        });
    }
    if (checkpoint.length) {
        built = buildWorkflow(manifest, independentCypress ? {...project, runnerOptions: {...project.runnerOptions, nativeConfig: project.native.config}} : project, checkpoint.map(t => t.staticId));
        ({decision} = costs.planWorkflow(built.workflow));
        const chosen = new Set(decision.selected);
        const byStaticId = new Map(checkpoint.map(test => [test.staticId, test]));
        checkpoint = built.workflow.select().filter(test => built.workflow.chain(test.parent)
            .some(stage => chosen.has(stage.id))).map(test => byStaticId.get(test.id));
    }

    const main = inventory.tests.filter(test => !groups.setup.some(setup => setup.id === test.id));
    const sourceTests = new Map(manifest.tests.map(test=>[test.id,test]));
    // fullyParallel is the runner's existing declaration that ordering within a
    // project is not required. Also require assessed, isolated page lifecycles;
    // custom/worker fixtures, serial groups and native-only hooks stay ordered.
    const mainProjects = new Set(main.map(test=>test.project));
    const orderingEligible = test => {
        const source=manifest.tests.find(source=>testKey({...source,file:path.join(manifest.root,source.file)})===testKey(test));
        return source && test.expectedStatus==='passed' && !test.serial &&
            !test.annotations?.some(a=>['skip','fixme','fail'].includes(a.type)) &&
            !source.restoration && !source.fixtureSetup?.length &&
            (project.adapter?.supportsOrdering ? project.adapter.supportsOrdering(source) === true : groups.checkpoint.some(candidate=>candidate.id===test.id));
    };
    const canGroup = checkpoint.length && mainProjects.size === 1 && main.every(orderingEligible) &&
        inventory.config.projects.find(project=>mainProjects.has(project.name))?.fullyParallel === true &&
        groups.checkpoint.every(test=>{const source=sourceTests.get(test.staticId); return !source.restoration && !source.fixtureSetup?.length;});
    const checkpointIds = new Set(checkpoint.map(test=>test.id));
    const ordered = canGroup ? [...main.filter(test=>!checkpointIds.has(test.id)),...main.filter(test=>checkpointIds.has(test.id))] : main;
    const blocks = [];
    for (const test of ordered) {
        const kind = checkpointIds.has(test.id) ? 'checkpoint' : 'native';
        if (blocks.at(-1)?.kind !== kind) blocks.push({kind,tests:[]});
        blocks.at(-1).tests.push(test);
    }
    const scheduled = [...groups.setup,...ordered].map(test=>test.id);
    const ordering = {basis:canGroup ? 'independent-page-project' : 'native-order', scheduled,
        changed:JSON.stringify(scheduled)!==JSON.stringify(inventory.tests.map(test=>test.id))};
    return {inventory,groups,checkpoint,decision,browserIneligible,independent,independentCypress,blocks,ordering};
}
async function runSuite(options) {
    const {manifest, project, directory, runner, runCheckpoint, coverageRoot} = options;
    const mode = 'AUTO', started = performance.now(), phases = [];
    const {inventory,groups,checkpoint,decision,browserIneligible,independent,independentCypress,blocks,ordering} = await prepareSuite(options);
    const report = {schemaVersion: 1, kind: 'full-native-suite', mode, inventory: inventory.tests, sourceDigest: manifest.sourceDigest,
        setupDiagnostics: {nativeCollectionMs: inventory.wallMs},
        diagnostics: manifest.diagnostics, assessment: manifest.assessment, decision, ordering, phases, results: [], checkpoints: 0, reuseHits: 0, status: 'failed',
        routing: {checkpoint: checkpoint.map(t => t.id), native: inventory.tests.filter(t => !checkpoint.some(c => c.id === t.id)).map(t => t.id),
            ...(browserIneligible.length ? {browserIneligible} : {})}};
    async function native(tests, options = {}) {
        const result = await runner.run(project.native.config, directory, {...options,
            ...(coverageRoot ? {coverageRoot} : {}), ...(tests ? {tests} : {})});
        validateNative(result, tests ?? inventory.tests); phases.push({kind: 'native', ...result}); report.results.push(...result.results.map(r => ({...r, execution: 'native'}))); return result;
    }
    if (!checkpoint.length) {
        report.selectionReason = decision ? 'No eligible shared prefixes; execute the complete native suite.' : 'No qualified split; execute the complete native suite.';
        await native();
    } else {
        if (!groups.setup.length && !independent) throw new Error('A mixed suite requires an explicit native setup project to own global setup before checkpoints');
        const setup = groups.setup.length ? await native(groups.setup, {teardown: false}) : {exitCode: 0, status: 'passed', results: []};
        if (setup.exitCode === 0 && setup.status === 'passed' && setup.results.every(r => r.status === 'passed')) {
            let baseline = project.costBaseline;
            for (const block of blocks) {
                if (block.kind === 'native') { await native(block.tests, {setup:false}); continue; }
                verifySources(manifest);
                const selected = block.tests.map(entry => checkpoint.find(test => test.id === entry.id));
                const configuration = {...project, costBaseline:baseline,
                    ...(independentCypress ? {runnerOptions:{...project.runnerOptions, nativeConfig:project.native.config}} : {})};
                const ids = selected.map(test=>test.staticId);
                const discovery = buildWorkflow(manifest,configuration,ids);
                const candidates = costs.planWorkflow(discovery.workflow).decision.selected;
                // Execute contiguous source fragments through selected boundaries;
                // unselected ancestors must not introduce readiness/collection work.
                const built = buildWorkflow(manifest,configuration,ids,candidates);
                const {plan, decision} = costs.planWorkflow(built.workflow);
                const byId = new Map(selected.map(test => [test.staticId,test]));
                const result = await runCheckpoint({...built, specs:built.workflow.select().map(test => test.id), plan}, decision);
                phases.push({kind:'checkpoint', report:result});
                for (const entry of result.results) {
                    const source = byId.get(entry.spec);
                    if (!source) throw new Error('Checkpoint worker returned an unselected test');
                    report.results.push({id:source.id, status:entry.status, execution:'checkpoint', original:entry});
                }
                report.checkpoints += result.checkpoints.length;
                report.reuseHits += result.counts.reuseHits;
                baseline = result.adaptive?.baselineAfter ?? baseline;
            }
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
module.exports = {partition, validateNative, collectAssessed, prepareSuite, runSuite, playwrightCoverageResult};
