// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Internal paired harness. Caller must verify dedicated installation ownership
// and mount owned reflink storage. Both arms use the same source and suite order.
const fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const base = path.resolve(__dirname, '../../..');
const load = file => require(path.join(base, file));
async function linearSuite(options) {
    const started = performance.now();
    const suite = load('branching/suite.cjs');
    const plan = await suite.prepareSuite(options);
    const report = {kind:'full-native-suite',status:'failed',inventory:plan.inventory.tests,ordering:plan.ordering,
        phases:[],results:[],sourceDigest:options.manifest.sourceDigest,checkpoints:0,reuseHits:0};
    const native = async (tests,settings={}) => {
        const phase = await options.runner.run(options.project.native.config,options.directory,
            {...settings,coverageRoot:options.coverageRoot,...(tests ? {tests} : {})});
        suite.validateNative(phase,tests ?? plan.inventory.tests);
        report.phases.push({kind:'native',...phase});
        report.results.push(...phase.results.map(result=>({...result,execution:'native'})));
        assert.equal(phase.status,'passed'); assert.equal(phase.exitCode,0); assert.deepEqual(phase.errors,[]);
    };
    if (!plan.checkpoint.length) await native();
    else {
        if (plan.groups.setup.length) await native(plan.groups.setup,{teardown:false});
        for (const block of plan.blocks) await native(block.tests,{setup:false});
    }
    assert.deepEqual(report.results.map(result=>result.id),plan.ordering.scheduled);
    assert.equal(report.results.length,report.inventory.length);
    report.status='passed'; report.wallMs=performance.now()-started;
    return report;
}
async function run([manifestFile, configuration, storage, output]) {
    const preparationStarted = performance.now();
    const manifest = load('branching/estimation.cjs').readManifest(manifestFile);
    const project = require(path.resolve(configuration));
    const leases = load('branching/workflow-lease.cjs');
    const lease = leases.acquire(process.cwd());
    const {coverageCommand} = load('branching/auto-cli.cjs');
    fs.mkdirSync(output, {recursive:true});
    const reports = [];
    let pairedFixture;
    const discoveryMs = Number(process.env.MAGELENS_DISCOVERY_MS);
    assert.ok(Number.isFinite(discoveryMs) && discoveryMs >= 0, 'Measured discovery duration is required');
    try {
        const store = load('branching/baseline.cjs').openProject(process.cwd(), {...project.baseline,storage,sourceDigest:manifest.sourceDigest,checkpointContext:{coverage:project.native?.coverage === true,runnerOptions:project.runnerOptions ?? {}}});
        let used = store.load();
        const baselinePreparationMs = performance.now() - preparationStarted;
        const preparation = performance.now();
        let calibration;
        if (used.source !== 'measured' || load('branching/configs/baseline.json').metrics.some(key => !used.samples[key])) {
            calibration = await load('branching/calibration-cli.cjs').measureProject({manifest,project,storage,workflowLease:lease,store});
            used = store.load();
        }
        const calibrationMs = calibration ? performance.now() - preparation : 0;
        const runner = load('branching/runners/playwright/native.cjs');
        project.adapter = load('branching/automatic.cjs').playwrightCoverageAdapter(manifest);
        const fixtureStarted = performance.now();
        pairedFixture = await require('./paired-fixture.cjs').fixture(process.cwd(),storage,process.env.MAGELENS_BENCHMARK_PROJECT,coverageCommand);
        const fixtureCaptureMs = performance.now()-fixtureStarted;
        for (const arm of ['linear', 'adaptive']) {
            const directory = path.join(output, arm);
            fs.mkdirSync(directory);
            const started = performance.now();
            let report;
            try {
                coverageCommand(['coverage_cleanup']);
                pairedFixture.reset();
                coverageCommand(['coverage_prepare','playwright','bin/run-playwright.cjs']);
                const coverage = load('branching/cli.cjs').activeCoverage(process.cwd());
                report = await (arm === 'linear' ? linearSuite : load('branching/suite.cjs').runSuite)({manifest,project:{...project,costBaseline:used.baseline},
                    directory,runner,coverageRoot:process.cwd(),runCheckpoint:async options => {
                        const {chromium} = require('@playwright/test');
                        const browser = await chromium.launch({channel:'chrome',headless:true});
                        assert.equal(browser.version(),process.env.CHROME_VERSION);
                        try {
                            const backend = new (load('branching/retained-magento.cjs').RetainedMagentoBackend)({workspace:process.cwd(),
                                helperImage:process.env.MAGELENS_BRANCHING_IMAGE,disposable:true,workflowLease:lease});
                            const provider = new (load('branching/retained-provider.cjs').RetainedProvider)({browser,backend,
                                baseURL:process.env.PLAYWRIGHT_BASE_URL,contextOptions:{ignoreHTTPSErrors:true},state:project.state,...coverage});
                            const input = {...options,provider,root:storage,checkpointLifetime:'last-consumer'};
                            const result = await load('branching/engine.cjs').execute(input);
                            result.browser = {name:'Chrome for Testing',version:browser.version()};
                            return result;
                        } finally { await browser.close(); }
                    }});
                assert.equal(report.status,'passed',JSON.stringify(report.phases.filter(p => p.kind === 'checkpoint').map(p => p.report.errors)));
                assert.equal(leases.needsRecovery(lease),false);
                const result = load('branching/suite.cjs').playwrightCoverageResult(report,coverage.coverageRunId,process.env.CHROME_VERSION);
                fs.writeFileSync('coverage/playwright-results.json',JSON.stringify(result));
                coverageCommand(['coverage_finalize']);
                const snapshot = load('tests/ci/report-equivalence.cjs').snapshot(path.resolve('coverage'));
                fs.writeFileSync(path.join(directory,'equivalence.json'),JSON.stringify(snapshot));
                report.sourceIdentities = JSON.parse(fs.readFileSync('coverage/run.json')).sources;
                report.baseline = {used,calibrationMs};
                if (arm === 'adaptive') report.baseline.update = store.update(report);
            } finally {
                if (!leases.needsRecovery(lease)) { coverageCommand(['coverage_cleanup']); pairedFixture.reset(); }
                if (report) {
                    fs.writeFileSync(path.join(directory,'suite.json'),JSON.stringify(report,null,2));
                    report.discoveryMs = arm === 'adaptive' ? discoveryMs : 0;
                    report.baselinePreparationMs = arm === 'adaptive' ? baselinePreparationMs : 0;
                    report.totalMs = performance.now() - started + report.discoveryMs + report.baselinePreparationMs;
                    fs.writeFileSync(path.join(directory,'suite.json'),JSON.stringify(report,null,2));
                    reports.push(report);
                }
            }
        }
        const snapshots = ['linear','adaptive'].map(arm => JSON.parse(fs.readFileSync(path.join(output,arm,'equivalence.json'))));
        const differences = load('tests/ci/report-equivalence.cjs').compareSnapshots(...snapshots);
        const [linear,adaptive] = reports;
        const comparison = {schemaVersion:1,linearReference:'complete-native-suite-in-shared-safe-order',sourceDigest:manifest.sourceDigest,calibrationMs,discoveryMs,baselinePreparationMs,fixtureCaptureMs,
            linearMs:linear.totalMs,adaptiveMs:adaptive.totalMs,savedMs:linear.totalMs-adaptive.totalMs,
            savedPercent:100*(linear.totalMs-adaptive.totalMs)/linear.totalMs,coverageDifferences:differences,
            order:reports.map(report => report.results.map(result => result.id)),
            baseline:used, decisions:adaptive.phases.filter(p => p.kind === 'checkpoint').map(p => p.report.adaptive)};
        fs.writeFileSync(path.join(output,'comparison.json'),JSON.stringify(comparison,null,2));
        assert.deepEqual(comparison.order[0],comparison.order[1]);
        assert.deepEqual(linear.sourceIdentities,adaptive.sourceIdentities,'Measured source identities changed');
        assert.deepEqual(differences,[],'Complete coverage outcomes differ');
        for (const snapshot of snapshots) {
            assert.ok(snapshot.php.totals.covered > 0, 'No PHP execution measured');
            assert.ok(snapshot.js.groups.all.statements.covered > 0, 'No JavaScript execution measured');
            assert.ok(snapshot.templates.totals.statements.covered > 0, 'No template execution measured');
            assert.ok(Object.values(snapshot.templates.files).some(file => file.status === 'observed'), 'No template DOM observations');
        }
        assert.ok(comparison.savedMs > 0,'No measured net saving');
        console.log(JSON.stringify({linearMs:comparison.linearMs,adaptiveMs:comparison.adaptiveMs,savedPercent:comparison.savedPercent}));
    } finally {
        if (pairedFixture && !leases.needsRecovery(lease)) pairedFixture.remove();
        if (!leases.release(lease)) { console.error('Benchmark workflow lock retained for recovery'); process.exitCode=1; }
    }
}
if (require.main === module) run(process.argv.slice(2)).catch(error => {console.error(error);process.exitCode=1;});
module.exports = {run};
