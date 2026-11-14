// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs=require('node:fs'),path=require('node:path');
const {openProject}=require('./baseline.cjs');
const {loadRunner}=require('./runners/index.cjs');
const {RetainedMagentoBackend}=require('./retained-magento.cjs');
const leases=require('./workflow-lease.cjs');
const {probe}=require('./storage.cjs');
async function run(args=process.argv.slice(2)) {
    try {return await execute(args);}
    catch(error){require('./estimation.cjs').recordFailure(args[0],error);throw error;}
}
async function execute(args) {
    if(args.length!==3)throw new Error('Expected MANIFEST.json CONFIG.cjs COW_STORAGE');
    const [manifestFile,configuration,storage]=args;
    const manifest=require('./estimation.cjs').readManifest(manifestFile);
    require('./automatic.cjs').verifySources(manifest);
    const supplied=require(path.resolve(configuration));
    const project=typeof supplied==='function'?await supplied(manifest):supplied;
    require('./costs.cjs').assertAutomatic(project);
    probe(storage);
    const workspace=process.cwd(),workflowLease=leases.acquire(workspace);
    let runtime,report,coverageStarted=false,output,leaseReleased;
    const {coverageCommand} = require('./auto-cli.cjs');
    try {
        const runner=loadRunner(process.env.MAGELENS_RUNNER??'playwright');
        const discovery=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'magelens-calibration-inventory-'));
        let inventory;
        try {inventory=await require('./suite.cjs').collectAssessed(manifest,project,discovery,runner.native,{calibration:true});}
        finally {fs.rmSync(discovery,{recursive:true,force:true});}
        const candidate = project.catalogQualification?.candidate;
        const qualificationSegment = candidate && require('./predictor/catalog-qualification.cjs').bindCatalogSegment(manifest, candidate);
        if (qualificationSegment && (process.env.MAGELENS_RUNNER ?? 'playwright') !== 'playwright')
            throw new Error('Catalog qualification measurement requires Playwright');
        if (qualificationSegment) {
            coverageStarted = true;
            coverageCommand(['coverage_cleanup']);
            coverageCommand(['coverage_prepare', 'playwright', 'bin/run-playwright.cjs']);
        }
        const coverage = qualificationSegment ? require('./cli.cjs').activeCoverage(workspace) : {};
        if (qualificationSegment && !coverage.coverageRunId)
            throw new Error('Catalog qualification measurement requires active coverage');
        const store = qualificationSegment ? null : openProject(workspace,project.baseline);
        const used = store?.load();
        runtime=await runner.open(process.env,project.runnerOptions);
        if(typeof runtime.calibrate!=='function')throw new Error('This runner does not support checkpoint calibration');
        const backend=new RetainedMagentoBackend({workspace,helperImage:process.env.MAGELENS_BRANCHING_IMAGE,disposable:true,workflowLease});
        const runtimeBefore = qualificationSegment && require('./predictor/catalog-observations.cjs').catalogRuntimeContext(backend);
        if (qualificationSegment) {
            require('./predictor/catalog-observations.cjs').assertCatalogEnvironment(qualificationSegment.snapshot, runtimeBefore);
            require('node:assert/strict').equal(project.catalogQualification.nativeProfile?.environment?.executionRuntimeDigest,
                require('./identity.cjs').digest(runtimeBefore), 'Native forecast profile does not identify the execution environment');
        }
        if (qualificationSegment) qualificationSegment.runtimeContext = () => {
            const actual = require('./predictor/catalog-observations.cjs').catalogRuntimeContext(backend);
            require('node:assert/strict').deepEqual(actual, runtimeBefore, 'Runtime context changed before prefix measurement');
            return actual;
        };
        report=await runtime.calibrate({backend,root:storage,samples:qualificationSegment ? 2 : 3,qualificationSegment,coverage});
        output=path.join(workspace,'.runtime/branching-results','calibration-'+report.run+'.json');
        fs.mkdirSync(path.dirname(output), {recursive:true});
        if (qualificationSegment) report.runtimeContext = {before:runtimeBefore,
            after:require('./predictor/catalog-observations.cjs').catalogRuntimeContext(backend)};
        if (qualificationSegment && report.status === 'passed')
            require('node:assert/strict').deepEqual(report.runtimeContext.after, runtimeBefore,
                'Runtime context changed before native collection');
        if (qualificationSegment && report.status === 'passed') {
            const retained = report.providerDiagnostics?.retainedServices;
            if (!retained?.schemasRemoved || !retained?.grantsRestored || leases.needsRecovery(workflowLease))
                throw new Error('Catalog measurement requires a clean retained-provider audit');
            const directory = path.join(workspace, '.runtime/branching-results', 'qualification-native-' + report.run);
            const native = await runner.native.run(project.native.config, directory, {coverageRoot:workspace,
                profile:project.catalogQualification.nativeProfile});
            report.runtimeContext.afterNative = require('./predictor/catalog-observations.cjs').catalogRuntimeContext(backend);
            require('node:assert/strict').deepEqual(report.runtimeContext.afterNative, runtimeBefore,
                'Runtime context changed during native collection');
            const {validateNative, playwrightCoverageResult} = require('./suite.cjs');
            validateNative(native, inventory.tests);
            const result = playwrightCoverageResult({status:native.exitCode === 0 && !native.errors.length ? native.status : 'failed',
                inventory:inventory.tests, phases:[], results:native.results.map(row => ({...row, execution:'native'}))},
            coverage.coverageRunId, process.env.CHROME_VERSION);
            require('./automatic.cjs').verifySources(manifest);
            fs.writeFileSync(path.join(workspace, 'coverage/playwright-results.json'), JSON.stringify(result));
            coverageCommand(['coverage_finalize']);
            const coverageDirectory = path.join(workspace, '.runtime/branching-results', 'coverage-' + report.run);
            const coverageEvidence = {};
            for (const name of ['run.json', 'summary.json', 'playwright-results.json', 'collector.json',
                'project-fixtures.json', 'php/coverage-summary.json', 'php/line-coverage.json',
                'javascript-summary.json', 'javascript-scope.json', 'js/coverage-final.json',
                'template-manifest.json', 'templates/coverage-summary.json']) {
                const bytes = fs.readFileSync(path.join(workspace, 'coverage', name));
                const destination = path.join(coverageDirectory, name);
                fs.mkdirSync(path.dirname(destination), {recursive:true});
                fs.writeFileSync(destination, bytes, {flag:'wx', mode:0o600});
                coverageEvidence[name] = require('./identity.cjs').fileDigest(destination);
            }
            report.native = {totalTests:result.totalTests, totalPassed:result.totalPassed, reportFile:native.reportFile,
                executionRuntimeDigest:require('./identity.cjs').digest(report.runtimeContext.afterNative),
                coverageRunId:coverage.coverageRunId, coverageFinalized:true,
                coverageDirectory, coverageEvidence,
                ...(native.profileArtifacts ? {profileArtifacts:native.profileArtifacts} : {})};
        }
        try {
            require('./automatic.cjs').verifySources(manifest);
            report.sourceIntegrity={verified:true,digest:manifest.sourceDigest};
        } catch (error) {
            report.sourceIntegrity={verified:false,digest:manifest.sourceDigest};
            report.status='failed';
            report.errors.push({phase:'source',message:error.message});
        }
        if (store) report.baseline={used,update:store.update(report,{explicit:true,replace:true})};
        const directory=path.join(workspace,'.runtime/branching-results');fs.mkdirSync(directory,{recursive:true});
        output=path.join(directory,'calibration-'+report.run+'.json');
        const uid=Number(process.env.MAGELENS_HOST_UID),gid=Number(process.env.MAGELENS_HOST_GID);
        if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(directory,uid,gid);
        console.log(`${report.status}: checkpoint calibration (${report.costs.captures.length} captures, ${report.costs.restores.length} restores)`);
        if(report.baseline?.update.updated)console.log(`Checkpoint decision baseline: ${report.baseline.update.decisionBaselineMs.toFixed(1)} ms (two-test break-even)`);
        for(const regression of report.baseline?.update.regressions??[])
            console.warn(`Checkpoint overhead increased: ${regression.metric} ${regression.referenceMs.toFixed(1)} → ${regression.observedMs.toFixed(1)} ms`);
        for(const error of report.errors)console.error(`${error.phase}: ${error.message}`);
        if(report.status!=='passed')process.exitCode=1;
        return report;
    } catch (error) {
        if (report) {
            report.status = 'failed';
            report.errors.push({phase:'collection', message:error.message});
        }
        throw error;
    } finally {
        try {await runtime?.close();}
        finally {
            try {
                if (coverageStarted && !leases.needsRecovery(workflowLease)) coverageCommand(['coverage_cleanup']);
            } finally {
                leaseReleased=leases.release(workflowLease);
                if(!leaseReleased){console.error('Calibration workflow lock retained for recovery');process.exitCode=1;}
            }
        }
        if (output) {
            report.cleanupVerified = leaseReleased;
            fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
            const uid=Number(process.env.MAGELENS_HOST_UID),gid=Number(process.env.MAGELENS_HOST_GID);
            if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(output,uid,gid);
            console.log(`Report: ${output}`);
            if (report.kind === 'catalog-qualification-measurement' && report.status === 'passed' && report.cleanupVerified) {
                const readCoverage = name => JSON.parse(fs.readFileSync(path.join(workspace, 'coverage', name), 'utf8'));
                const observations = require('./predictor/catalog-observations.cjs').catalogObservations({
                    manifest, candidateId:project.catalogQualification.candidate, report,
                    coverageResult:readCoverage('playwright-results.json'), coverageSummary:readCoverage('summary.json')
                });
                const observationsFile = output.replace(/\.json$/, '.observations.json');
                fs.writeFileSync(observationsFile, JSON.stringify(observations,null,2)+'\n', {mode:0o600});
                if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(observationsFile,uid,gid);
                console.log(`Observations: ${observationsFile}`);
            }
        }
    }
}
if(require.main===module)run().catch(error=>{console.error(require('./estimation.cjs').formatError(error));process.exitCode=1;});
module.exports={run};
