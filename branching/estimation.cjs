// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
class EstimationError extends Error {
    constructor(issues, message = 'Cost assessment failed; no tests may execute until all work is assessed') {
        super(message);
        this.name = 'EstimationError';
        this.statusCode = 500;
        this.code = 'ESTIMATION_FAILED';
        this.issues = issues;
        this.remediation = 'Resolve every analysis issue and replan.';
    }
    toJSON() {
        return {statusCode: this.statusCode, code: this.code, message: this.message, issues: this.issues, remediation: this.remediation};
    }
}
function assertAssessed(manifest) {
    const a=manifest?.assessment;
    if (manifest?.schemaVersion!==1 || manifest?.implementation!=='rust-prefix-v3' || a?.version!=='ml-duration-v1')
        throw new EstimationError([{phase:'manifest',message:'An ML assessment is required; replan'}], 'An ML assessment is required; replan');
    const issues=[...(a.issues ?? [])];
    if (manifest.diagnostics?.length || !manifest.tests?.length || a.analysis?.collectionComplete!==true)
        issues.push({phase:'collection',message:'Incomplete source inventory'});
    if (a.status!=='complete' || !/^[a-f0-9]{64}$/.test(a.modelId ?? ''))
        issues.push({phase:'predictor',message:'A complete ML assessment is required'});
    const prefixModelId = a.prefixModelId ?? a.modelId;
    if (!/^[a-f0-9]{64}$/.test(prefixModelId ?? ''))
        issues.push({phase:'predictor',message:'Invalid prefix model identity'});
    function check(id, row, modelId, emptyAllowed=false) {
        const p=row?.prediction;
        if (!p || p.modelId!==modelId || row.predictionError ||
            !Number.isFinite(p.ms) || p.ms<0 || (p.ms===0 && !(emptyAllowed && row.empty)))
            issues.push({phase:'predictor',id,message:'Missing or invalid ML prediction'});
    }
    for(const test of manifest.tests ?? []) {
        check(test.id,a.tests?.[test.id],a.modelId);
        check(`root-${test.scope.slice(0,20)}`,a.stages?.[`root-${test.scope.slice(0,20)}`],prefixModelId,true);
    }
    for(const cp of manifest.checkpoints ?? []) check(cp.id,a.stages?.[cp.id],prefixModelId);
    if(issues.length) throw new EstimationError(issues);
}
function assertExecutable(manifest) {
    assertAssessed(manifest);
    const {executionEligible, tests, stages} = manifest.assessment;
    if (executionEligible === true) return;
    const issues = [{phase: 'qualification',
        message: 'Forecasts are available, but checkpoint execution requires qualified predictions for their timing boundaries'}];
    for (const [id, row] of [...Object.entries(tests ?? {}), ...Object.entries(stages ?? {})]) {
        if (row.empty || row.prediction?.executionEligible === true) continue;
        const reasons = [];
        if (row.prediction?.qualified === false) reasons.push('Model has not passed independent qualification');
        if (row.prediction?.domainMatched === false) reasons.push('Timing boundary has no matching validated model domain');
        if (row.prediction?.outOfRange === true) reasons.push('Source features are outside the training range');
        issues.push({phase: 'qualification', id, unit: row.unit, timingBoundary: row.timingBoundary,
            message: reasons.join('. ') || 'Forecast is ineligible for execution'});
    }
    throw new EstimationError(issues);
}
function readManifest(file) {
    try {
        // A failed replan must not silently revive the previous successful plan.
        const failure = readFailure(file);
        if (failure) throw new EstimationError(failure.issues, failure.message);
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        assertAssessed(manifest);
        return manifest;
    } catch (error) {
        if (error instanceof EstimationError) throw error;
        throw new EstimationError([{phase: 'manifest', message: error.message}]);
    }
}
function readFailure(file) {
    try {
        const failure = JSON.parse(fs.readFileSync(file + '.error.json', 'utf8'));
        if (failure.code !== 'ESTIMATION_FAILED' || failure.statusCode !== 500 || !Array.isArray(failure.issues))
            throw new Error('Invalid assessment failure report');
        return failure;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new EstimationError([{phase: 'manifest', message: error.message}]);
    }
}
function formatError(error) {
    return error instanceof EstimationError ? JSON.stringify(error) : error.message;
}
function recordFailure(file, error) {
    if (!(error instanceof EstimationError) || !file) return;
    const temporary = `${file}.error-${randomUUID()}.tmp`;
    let owned = false;
    try {
        const fd = fs.openSync(temporary, 'wx', 0o600); owned = true;
        try { fs.writeFileSync(fd, JSON.stringify(error, null, 2) + '\n'); }
        finally { fs.closeSync(fd); }
        const uid = Number(process.env.MAGELENS_HOST_UID), gid = Number(process.env.MAGELENS_HOST_GID);
        if (Number.isInteger(uid) && Number.isInteger(gid)) fs.chownSync(temporary, uid, gid);
        fs.renameSync(temporary, file + '.error.json');
    } catch (failure) {
        error.issues.push({phase: 'failure-report', message: `Could not save assessment failure: ${failure.message}`});
    } finally {
        if (owned) try { fs.rmSync(temporary, {force: true}); }
        catch (failure) { error.issues.push({phase: 'failure-report', message: `Could not remove temporary failure report: ${failure.message}`}); }
    }
}
module.exports = {EstimationError, assertAssessed, assertExecutable, readManifest, readFailure, recordFailure, formatError};
