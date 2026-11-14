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
    const a = manifest?.assessment;
    if (manifest?.schemaVersion !== 1 || manifest?.implementation !== 'rust-prefix-v3' || a?.version !== 'measured-first-use-v1')
        throw new EstimationError([{phase: 'manifest', message: 'Replan for measured-first-use checkpoint reuse; ML manifests are no longer supported'}]);
    if (!manifest.tests?.length || manifest.diagnostics?.length || a.analysis?.collectionComplete !== true || a.status !== 'complete')
        throw new EstimationError([{phase: 'collection', message: 'Incomplete source inventory'}]);
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
module.exports = {EstimationError, assertAssessed, readManifest, readFailure, recordFailure, formatError};
