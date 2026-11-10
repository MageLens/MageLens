// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {EstimationError} = require('../estimation.cjs');
const {reachableContext} = require('./reachable.cjs');
const COUNTS_SCHEMA = 'syntax-hash-v2-babel-7.29.9';
const FEATURE_SCHEMA = 'syntax-roles-v3-babel-7.29.9';
const REACHABLE_SCHEMA = 'syntax-reachable-v4-babel-7.29.9';
const SCHEMAS = ['syntax-hash-v1-babel-7.29.9', COUNTS_SCHEMA, FEATURE_SCHEMA, REACHABLE_SCHEMA];
const COUNTS_WIDTH = 72, WIDTH = COUNTS_WIDTH * 2, REACHABLE_WIDTH = 1024, HALF_REACHABLE = 512;
const width = schema => schema === REACHABLE_SCHEMA ? REACHABLE_WIDTH : schema === FEATURE_SCHEMA ? WIDTH : COUNTS_WIDTH;
// Bounded syntax-vector cache: helpers shared by many tests are parsed once.
// Keys include source bytes and schema; no project source or AST is retained.
const syntaxCache = new Map();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const qualified = n => !n ? '' : n.type === 'Identifier' ? n.name : n.type === 'ThisExpression' ? 'this' : n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression' ? qualified(n.object) + '.' + (n.computed ? '[]' : n.property.name) : n.type === 'CallExpression' ? qualified(n.callee) + '()' : n.type;
function fail(message) { throw new EstimationError([{phase: 'predictor', message}]); }
function ensure(condition, message) { if (!condition) fail(message); }
function counts(request) {
    ensure(['playwright', 'cypress'].includes(request.runner), 'Unknown runner');
    ensure(['suite-tests', 'test', 'prefix'].includes(request.unit), 'Unknown timing boundary');
    const schema = request.featureSchema;
    ensure(SCHEMAS.includes(schema), 'Unknown feature schema');
    ensure(Array.isArray(request.sources) && request.sources.length > 0, 'Source corpus is required');
    const roleWidth = schema === REACHABLE_SCHEMA ? HALF_REACHABLE : COUNTS_WIDTH;
    const bucketCount = schema === REACHABLE_SCHEMA ? HALF_REACHABLE - 8 : 64;
    const vector = Array(roleWidth).fill(0), fingerprints = [];
    vector[0] = request.runner === 'playwright' ? 1 : 0;
    vector[1] = request.runner === 'cypress' ? 1 : 0;
    vector[2] = request.unit === 'prefix' ? 1 : 0;
    const add = (target, name, amount = 1) => { target[8 + parseInt(sha256(name).slice(0, 8), 16) % bucketCount] += amount; };
    const parser = require('@babel/parser');
    ensure(require('@babel/parser/package.json').version === '7.29.9', 'Feature parser version changed; retrain');
    for (const {name, source} of [...request.sources].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        ensure(typeof name === 'string' && typeof source === 'string', 'Invalid source corpus');
        const sourceHash=sha256(source),cacheKey=schema+':'+sourceHash;
        fingerprints.push([name, sourceHash]);
        vector[3] += Buffer.byteLength(source); vector[4]++;
        const cached=syntaxCache.get(cacheKey);
        if(cached) {
            vector[5]+=cached[5];vector[6]+=cached[6];vector[7]=Math.max(vector[7],cached[7]);
            for(let i=8;i<roleWidth;i++)vector[i]+=cached[i];
            continue;
        }
        const counts=Array(roleWidth).fill(0);
        let ast;
        try { ast = parser.parse(source, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']}); }
        catch (error) { fail(`Cannot parse source ${name}: ${error.message}`); }
        const pending = [ast];
        while (pending.length) {
            const node = pending.pop();
            if (!node || typeof node !== 'object') continue;
            if (Array.isArray(node)) { pending.push(...node); continue; }
            if (typeof node.type !== 'string') continue;
            add(counts,'syntax:' + node.type); counts[5]++;
            if (schema === COUNTS_SCHEMA && ['CallExpression', 'OptionalCallExpression'].includes(node.type))
                add(counts,'call:' + (node.callee.property?.name ?? node.callee.name ?? node.callee.type));
            if (schema === REACHABLE_SCHEMA && ['CallExpression', 'OptionalCallExpression', 'NewExpression'].includes(node.type))
                add(counts, 'call:' + qualified(node.callee));
            if (node.type === 'NumericLiteral') {
                counts[6] += Math.log1p(Math.abs(node.value));
                counts[7] = Math.max(counts[7], Math.log1p(Math.abs(node.value)));
            }
            // Generic syntax counts, never evaluation of project JavaScript.
            for (const [key, value] of Object.entries(node))
                if (!['loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key) && value && typeof value === 'object') pending.push(value);
        }
        vector[5]+=counts[5];vector[6]+=counts[6];vector[7]=Math.max(vector[7],counts[7]);
        for(let i=8;i<roleWidth;i++)vector[i]+=counts[i];
        if(syntaxCache.size>=1024)syntaxCache.delete(syntaxCache.keys().next().value);
        syntaxCache.set(cacheKey,counts);
    }
    ensure(new Set(fingerprints.map(([name]) => name)).size === fingerprints.length, 'Duplicate source in corpus');
    for (const [name, value] of Object.entries(request.extraFeatures ?? {}).sort()) {
        ensure(/^[a-z][a-z0-9_.-]{0,79}$/.test(name) && Number.isFinite(value) && value >= 0, 'Extension features must be named nonnegative finite numbers');
        add(vector,'extension:' + name, Math.log1p(value));
    }
    return {featureSchema: schema, vector, sourceDigest: sha256(JSON.stringify(fingerprints))};
}
function features(request) {
    const schema=request.featureSchema ?? FEATURE_SCHEMA;
    if (schema === REACHABLE_SCHEMA) {
        ensure(Array.isArray(request.sources) && request.sources.length>0, 'Source corpus is required');
        ensure(request.sources.every(s=>['work','context'].includes(s.role ?? 'work')), 'Unknown source role');
        ensure(new Set(request.sources.map(s=>s.name)).size===request.sources.length, 'Duplicate source in corpus');
        const work=request.sources.filter(s=>s.role!=='context');
        ensure(work.length>0, 'Work source is required');
        const reachable = reachableContext(request.sources);
        const primary = counts({...request, featureSchema: REACHABLE_SCHEMA, sources: work});
        const supporting = reachable.length ? counts({...request, featureSchema: REACHABLE_SCHEMA, sources: reachable, extraFeatures: {}}).vector : Array(HALF_REACHABLE).fill(0);
        const fingerprints = [...request.sources].sort((a,b)=>a.name.localeCompare(b.name,'en'))
            .map(s=>[s.name,sha256(s.source),s.role ?? 'work']);
        return {featureSchema: schema, vector: [...primary.vector, ...supporting], sourceDigest: sha256(JSON.stringify(fingerprints))};
    }
    if(schema!==FEATURE_SCHEMA)return counts({...request,featureSchema:schema});
    ensure(Array.isArray(request.sources) && request.sources.length>0, 'Source corpus is required');
    ensure(request.sources.every(s=>['work','context'].includes(s.role ?? 'work')), 'Unknown source role');
    ensure(new Set(request.sources.map(s=>s.name)).size===request.sources.length, 'Duplicate source in corpus');
    const work=request.sources.filter(s=>s.role!=='context'), context=request.sources.filter(s=>s.role==='context');
    ensure(work.length>0, 'Work source is required');
    const primary=counts({...request,featureSchema:COUNTS_SCHEMA,sources:work});
    const supporting=context.length ? counts({...request,featureSchema:COUNTS_SCHEMA,sources:context,extraFeatures:{}}).vector : Array(COUNTS_WIDTH).fill(0);
    const fingerprints=[...request.sources].sort((a,b)=>a.name.localeCompare(b.name,'en'))
        .map(s=>[s.name,sha256(s.source),s.role ?? 'work']);
    return {featureSchema:schema,vector:[...primary.vector,...supporting],sourceDigest:sha256(JSON.stringify(fingerprints))};
}
function loadModel(file, expectedDigest) {
    let bytes, model;
    try { bytes = fs.readFileSync(file); model = JSON.parse(bytes); }
    catch (error) { fail(`Cannot load model: ${error.message}`); }
    const id = sha256(bytes);
    ensure(!expectedDigest || expectedDigest === id, 'Model digest mismatch');
    ensure(model.schemaVersion === 1 && SCHEMAS.includes(model.featureSchema), 'Incompatible model schema');
    const e = model.estimator;
    ensure(e && ['identity', 'log1p'].includes(e.inputTransform ?? 'identity'), 'Unknown model input transform');
    ensure(e && Number.isFinite(e.intercept) && ['mean', 'scale', 'coefficients'].every(key =>
        Array.isArray(e[key]) && e[key].length === width(model.featureSchema) && e[key].every(Number.isFinite)) && e.scale.every(x => x > 0), 'Invalid model coefficients');
    ensure(Number.isFinite(model.errorLogP90) && model.errorLogP90 >= 0 && Array.isArray(model.domains) && model.domains.length > 0, 'Missing model validation');
    ensure(typeof model.qualified === 'boolean' && Number.isFinite(model.referenceBaselineMs) && model.referenceBaselineMs > 0 &&
        model.domains.every(d => ['playwright', 'cypress'].includes(d.runner) && ['suite-tests', 'test', 'prefix'].includes(d.unit) &&
            Array.isArray(d.ranges) && d.ranges.length === width(model.featureSchema) && d.ranges.every(r => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] <= r[1])), 'Invalid model domain or baseline');
    return {id, model};
}
function predict(snapshot, loaded, {shadow = false} = {}) {
    const {model, id} = loaded;
    ensure(snapshot.featureSchema === model.featureSchema && snapshot.vector.length === width(model.featureSchema) && snapshot.vector.every(Number.isFinite), 'Invalid feature vector');
    ensure(shadow || model.qualified === true, 'Model has not passed held-out qualification');
    const domains = model.domains.filter(d => d.runner === snapshot.runner && d.unit === snapshot.unit &&
        (d.timingBoundary ?? null) === (snapshot.timingBoundary ?? null));
    ensure(domains.length, 'No training evidence for this runner and timing boundary');
    const environmentKnown = domains.some(d => d.environmentDigest === snapshot.environmentDigest);
    const e = model.estimator;
    ensure(snapshot.vector.every(x => x >= 0), 'Negative syntax features');
    const logMs = e.intercept + snapshot.vector.reduce((sum, x, i) =>
        sum + ((e.inputTransform === 'log1p' ? Math.log1p(x) : x) - e.mean[i]) / e.scale[i] * e.coefficients[i], 0);
    const ms = Math.expm1(logMs);
    ensure(Number.isFinite(ms) && ms > 0, 'Invalid predicted duration');
    const outOfRange = snapshot.vector.some((x, i) => x < Math.min(...domains.map(d => d.ranges[i][0])) || x > Math.max(...domains.map(d => d.ranges[i][1])));
    ensure(shadow || !outOfRange, 'Workload is outside the trained feature range');
    ensure(Number.isFinite(model.referenceBaselineMs) && model.referenceBaselineMs > 0 &&
        Number.isFinite(snapshot.baselineMs) && snapshot.baselineMs > 0 &&
        Number.isFinite(snapshot.manualMultiplier) && snapshot.manualMultiplier > 0, 'Missing or invalid pre-run baseline or multiplier');
    const factor = snapshot.baselineMs / model.referenceBaselineMs * snapshot.manualMultiplier;
    ensure(Number.isFinite(ms * factor) && ms * factor > 0 && Number.isFinite(Math.expm1(logMs + model.errorLogP90) * factor), 'Prediction scaling overflow');
    return {modelId: id, rawMs: ms, ms: ms * factor, factor, environmentKnown,
        referenceBaselineMs: model.referenceBaselineMs, baselineMs: snapshot.baselineMs, manualMultiplier: snapshot.manualMultiplier,
        rawLowerMs: Math.max(0, Math.expm1(logMs - model.errorLogP90)), rawUpperMs: Math.expm1(logMs + model.errorLogP90),
        lowerMs: Math.max(0, Math.expm1(logMs - model.errorLogP90)) * factor,
        upperMs: Math.expm1(logMs + model.errorLogP90) * factor, outOfRange, qualified: model.qualified};
}
function prepare(request, loaded) {
    ensure(request.timingBoundary === undefined || (typeof request.timingBoundary === 'string' && /^[a-z0-9][a-z0-9_./-]{0,99}$/.test(request.timingBoundary)), 'Invalid timing boundary version');
    ensure(request.environment && Object.keys(request.environment).length > 0, 'Environment identity is required');
    ensure(typeof request.group === 'string' && request.group && typeof request.sourceFamily === 'string' && request.sourceFamily, 'Training group and source family are required');
    const environmentDigest = sha256(JSON.stringify(Object.entries(request.environment).sort()));
    const snapshot = {schemaVersion: 1, observationId: randomUUID(), ...features({...request, featureSchema: loaded?.model.featureSchema ?? request.featureSchema}), runner: request.runner, unit: request.unit,
        ...(request.timingBoundary ? {timingBoundary:request.timingBoundary} : {}),
        group: sha256(request.group), sourceFamily: sha256(request.sourceFamily), environmentDigest,
        extraFeatures: {...request.extraFeatures},
        baselineMs: request.baselineMs, manualMultiplier: request.manualMultiplier ?? 1,
        capturedAt: new Date().toISOString(), prediction: null, predictionError: null};
    if (request.sourceStore) {
        fs.mkdirSync(request.sourceStore, {recursive: true, mode: 0o700});
        snapshot.sourceArchive = request.sources.map(({name,source,role}) => {
            const digest=sha256(source), file=path.join(request.sourceStore,digest);
            try { fs.writeFileSync(file,source,{flag:'wx',mode:0o600}); }
            catch(error) {
                if(error.code!=='EEXIST')throw error;
                ensure(sha256(fs.readFileSync(file))===digest,'Archived training source changed');
            }
            return {name,sha256:digest,...(role ? {role} : {})};
        });
    }
    try {
        ensure(loaded, 'No model configured');
        snapshot.prediction = predict(snapshot, loaded, {shadow: true});
    } catch (error) { snapshot.predictionError = error.toJSON?.() ?? {statusCode: 500, code: 'ESTIMATION_FAILED', message: error.message}; }
    return snapshot;
}
function observe(snapshot, actualMs, {passed, attempts = 1, sourceDigest} = {}) {
    ensure(Number.isFinite(actualMs) && actualMs > 0, 'Invalid measured duration');
    const eligible = passed === true && attempts === 1 && sourceDigest === snapshot.sourceDigest;
    return {...snapshot, observedAt: new Date().toISOString(), actualMs, eligible,
        exclusion: eligible ? null : 'Failed, retried, incomplete or changed-source run',
        errorMs: snapshot.prediction ? snapshot.prediction.ms - actualMs : null};
}
function evaluate(rows) {
    const valid = rows.filter(r => r.eligible), scored = valid.filter(r => r.prediction && Number.isFinite(r.errorMs));
    const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(q * values.length) - 1)] ?? null;
    const groups = {};
    for (const row of scored) (groups[`${row.runner}/${row.unit}/${row.sourceFamily}`] ??= []).push(row);
    const metrics = items => ({samples: items.length,
        meanAbsoluteErrorMs: items.length ? items.reduce((s, r) => s + Math.abs(r.errorMs), 0) / items.length : null,
        biasMs: items.length ? items.reduce((s, r) => s + r.errorMs, 0) / items.length : null,
        medianAbsolutePercentError: percentile(items.map(r => Math.abs(r.errorMs) / r.actualMs * 100), .5),
        p90AbsolutePercentError: percentile(items.map(r => Math.abs(r.errorMs) / r.actualMs * 100), .9),
        intervalCoverage: items.length ? items.filter(r => r.actualMs >= r.prediction.lowerMs && r.actualMs <= r.prediction.upperMs).length / items.length : null});
    return {schemaVersion: 1, status: scored.length === valid.length && valid.length > 0 ? 'scored' : 'incomplete',
        total: rows.length, eligible: valid.length, excluded: rows.length - valid.length, unpredicted: valid.length - scored.length,
        modelIds: [...new Set(scored.map(r => r.prediction.modelId))], outOfRange: scored.filter(r => r.prediction.outOfRange).length,
        ...metrics(scored), raw: metrics(scored.map(r => ({...r, errorMs: r.prediction.rawMs - r.actualMs,
            prediction: {...r.prediction, lowerMs: r.prediction.rawLowerMs, upperMs: r.prediction.rawUpperMs}}))),
        groups: Object.fromEntries(Object.entries(groups).map(([key, items]) => [key, metrics(items)])),
        checkpointDecisions: {status: 'unmeasured', reason: 'Whole-suite durations are not shared-prefix labels'}};
}
module.exports = {FEATURE_SCHEMA, WIDTH, REACHABLE_SCHEMA, REACHABLE_WIDTH, sha256, features, loadModel, predict, prepare, observe, evaluate};
