// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {EstimationError} = require('../estimation.cjs');
const {reachableContext} = require('./reachable.cjs');
const {reachableContext: reachableContextV4} = require('./reachable-v4.cjs');
const COUNTS_SCHEMA = 'syntax-hash-v2-babel-7.29.9';
const FEATURE_SCHEMA = 'syntax-roles-v3-babel-7.29.9';
const REACHABLE_SCHEMA_V4 = 'syntax-reachable-v4-babel-7.29.9';
const REACHABLE_SCHEMA_V5 = 'syntax-reachable-v5-babel-7.29.9';
const REACHABLE_SCHEMA_V6 = 'syntax-reachable-v6-babel-7.29.9';
const REACHABLE_SCHEMA = REACHABLE_SCHEMA_V6;
const SCHEMAS = ['syntax-hash-v1-babel-7.29.9', COUNTS_SCHEMA, FEATURE_SCHEMA, REACHABLE_SCHEMA_V4, REACHABLE_SCHEMA_V5, REACHABLE_SCHEMA_V6];
const COUNTS_WIDTH = 72, WIDTH = COUNTS_WIDTH * 2, REACHABLE_WIDTH = 1024, HALF_REACHABLE = 512;
const isModernReachableSchema = schema => schema === REACHABLE_SCHEMA_V5 || schema === REACHABLE_SCHEMA_V6;
const isReachableSchema = schema => schema === REACHABLE_SCHEMA_V4 || isModernReachableSchema(schema);
const width = schema => isReachableSchema(schema) ? REACHABLE_WIDTH : schema === FEATURE_SCHEMA ? WIDTH : COUNTS_WIDTH;
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
    const roleWidth = isReachableSchema(schema) ? HALF_REACHABLE : COUNTS_WIDTH;
    const bucketCount = isReachableSchema(schema) ? HALF_REACHABLE - 8 : 64;
    const vector = Array(roleWidth).fill(0), fingerprints = [];
    vector[0] = request.runner === 'playwright' ? 1 : 0;
    vector[1] = request.runner === 'cypress' ? 1 : 0;
    vector[2] = request.unit === 'prefix' ? 1 : 0;
    const add = (target, name, amount = 1) => { target[8 + parseInt(sha256(name).slice(0, 8), 16) % bucketCount] += amount; };
    const parser = require('@babel/parser');
    ensure(require('@babel/parser/package.json').version === '7.29.9', 'Feature parser version changed; retrain');
    for (const {name, source} of [...request.sources].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        ensure(typeof name === 'string' && typeof source === 'string', 'Invalid source corpus');
        const sourceHash=sha256(source),cacheKey=schema+':'+(schema === REACHABLE_SCHEMA_V6 ? request.runner+':' : '')+sourceHash;
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
            if (isReachableSchema(schema) && ['CallExpression', 'OptionalCallExpression', 'NewExpression'].includes(node.type)) {
                const canonical = schema === REACHABLE_SCHEMA_V6 && request.runner === 'playwright'
                    ? require('./playwright-call-features.cjs').playwrightCallFeature(node) : undefined;
                if (canonical !== null) add(counts, 'call:' + (canonical ?? qualified(node.callee)));
            }
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
const backendFields = new Set([
    'fixtureBytes','dataRows','indexBacklog','cpuCount','memoryBytes','workers'
]);

function backendFeatures(state) {
    if (state === undefined) return {};
    ensure(state && state.version === 1 && typeof state === 'object', 'Invalid pre-run backend state version');
    const result = {};
    for (const [name,value] of Object.entries(state)) {
        if (name === 'version') continue;
        if (name === 'cacheState') {
            ensure(value === 'warm' || value === 'cold', 'Invalid pre-run cache state');
            result['backend.v1.cache.'+value] = 1;
        } else {
            ensure(backendFields.has(name) && Number.isSafeInteger(value) && value >= 0,
                'Invalid pre-run backend field: '+name);
            // Keep a measured zero distinct from missing metadata.
            result['backend.v1.'+name.toLowerCase()+'.known'] = 1;
            result['backend.v1.'+name.toLowerCase()] = value;
        }
    }
    return result;
}

function features(request) {
    const schema=request.featureSchema ?? FEATURE_SCHEMA;
    if (isReachableSchema(schema)) {
        ensure(Array.isArray(request.sources) && request.sources.length>0, 'Source corpus is required');
        ensure(request.sources.every(s=>['work','context'].includes(s.role ?? 'work')), 'Unknown source role');
        ensure(new Set(request.sources.map(s=>s.name)).size===request.sources.length, 'Duplicate source in corpus');
        const work=request.sources.filter(s=>s.role!=='context');
        ensure(work.length>0, 'Work source is required');
        const extractor = schema === REACHABLE_SCHEMA_V4 ? reachableContextV4 : reachableContext;
        const reachable = extractor(request.sources);
        const primary = counts({...request, featureSchema: schema, sources: work, extraFeatures: isModernReachableSchema(schema)
            ? {...request.extraFeatures,...backendFeatures(request.backendState)} : request.extraFeatures});
        const supporting = reachable.length ? counts({...request, featureSchema: schema, sources: reachable, extraFeatures: {}}).vector : Array(HALF_REACHABLE).fill(0);
        const fingerprints = [...request.sources].sort((a,b)=>a.name.localeCompare(b.name,'en'))
            .map(s=>[s.name,sha256(s.source),s.role ?? 'work', ...(schema !== REACHABLE_SCHEMA_V4 && s.origin ? [[s.origin.file,(s.origin.ranges ?? [s.origin]).map(({start,end})=>[start,end])]] : [])]);
        return {
            featureSchema: schema,
            vector: [...primary.vector, ...supporting],
            sourceDigest: sha256(JSON.stringify(fingerprints)),
            selectedImplementations: reachable.map(s => s.name),
            unresolvedEdges: reachable.unknownEdges ?? [],
            ...(isModernReachableSchema(schema) ? {registeredCalls: (reachable.edges ?? []).filter(edge=>edge.registration),
                processCalls: (reachable.edges ?? []).filter(edge=>edge.process)} : {})
        };
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
    ensure(['log1p','log'].includes(e.targetTransform ?? 'log1p'), 'Unknown model target transform');
    ensure(e && Number.isFinite(e.intercept) && ['mean', 'scale', 'coefficients'].every(key =>
        Array.isArray(e[key]) && e[key].length === width(model.featureSchema) && e[key].every(Number.isFinite)) && e.scale.every(x => x > 0), 'Invalid model coefficients');
    ensure(Number.isFinite(model.errorLogP90) && model.errorLogP90 >= 0 && Array.isArray(model.domains) && model.domains.length > 0, 'Missing model validation');
    ensure(typeof model.qualified === 'boolean' && Number.isFinite(model.referenceBaselineMs) && model.referenceBaselineMs > 0 &&
        model.domains.every(d => ['playwright', 'cypress'].includes(d.runner) && ['suite-tests', 'test', 'prefix'].includes(d.unit) &&
            Array.isArray(d.ranges) && d.ranges.length === width(model.featureSchema) && d.ranges.every(r => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] <= r[1])), 'Invalid model domain or baseline');
    return {id, model};
}
function predict(snapshot, loaded, {shadow = false, transfer = false} = {}) {
    const {model, id} = loaded;
    ensure(snapshot.featureSchema === model.featureSchema && snapshot.vector.length === width(model.featureSchema) && snapshot.vector.every(Number.isFinite), 'Invalid feature vector');
    ensure(shadow || model.qualified === true, 'Model has not passed held-out qualification');
    const domains = model.domains.filter(d => d.runner === snapshot.runner && d.unit === snapshot.unit &&
        (d.timingBoundary ?? null) === (snapshot.timingBoundary ?? null));
    ensure(transfer || domains.length, 'No training evidence for this runner and timing boundary');
    const domainMatched = domains.length > 0;
    const referenceDomains = domainMatched ? domains : model.domains.filter(d => d.runner === snapshot.runner);
    const ranges = referenceDomains.length ? referenceDomains : model.domains;
    const environmentKnown = domains.some(d => d.environmentDigest === snapshot.environmentDigest);
    ensure(shadow || environmentKnown, 'Environment has not passed model qualification');
    const e = model.estimator;
    ensure(snapshot.vector.every(x => x >= 0), 'Negative syntax features');
    const logMs = e.intercept + snapshot.vector.reduce((sum, x, i) =>
        sum + ((e.inputTransform === 'log1p' ? Math.log1p(x) : x) - e.mean[i]) / e.scale[i] * e.coefficients[i], 0);
    const inverse = e.targetTransform === 'log' ? Math.exp : Math.expm1;
    const ms = inverse(logMs);
    ensure(Number.isFinite(ms), 'Model predicted a nonfinite duration');
    ensure(ms > 0, 'Model predicted a nonpositive duration');
    const matchingEnvironment = domains.filter(d=>d.environmentDigest === snapshot.environmentDigest);
    const eligibleRanges = matchingEnvironment.length ? matchingEnvironment : ranges;
    const outOfRange = isModernReachableSchema(snapshot.featureSchema)
        ? !eligibleRanges.some(domain=>snapshot.vector.every((value,i)=>value>=domain.ranges[i][0] && value<=domain.ranges[i][1]))
        : snapshot.vector.some((x, i) => x < Math.min(...ranges.map(d => d.ranges[i][0])) || x > Math.max(...ranges.map(d => d.ranges[i][1])));
    ensure(shadow || !outOfRange, 'Workload is outside the trained feature range');
    ensure(Number.isFinite(model.referenceBaselineMs) && model.referenceBaselineMs > 0 &&
        Number.isFinite(snapshot.baselineMs) && snapshot.baselineMs > 0 &&
        Number.isFinite(snapshot.manualMultiplier) && snapshot.manualMultiplier > 0, 'Missing or invalid pre-run baseline or multiplier');
    const factor = snapshot.baselineMs / model.referenceBaselineMs * snapshot.manualMultiplier;
    const lower = Math.max(0,inverse(logMs - model.errorLogP90)), upper = inverse(logMs + model.errorLogP90);
    ensure(Number.isFinite(ms * factor) && ms * factor > 0 && Number.isFinite(upper * factor), 'Prediction scaling overflow');
    return {modelId: id, rawMs: ms, ms: ms * factor, factor, environmentKnown, ...(transfer ? {domainMatched, executionEligible:model.qualified && domainMatched && environmentKnown && !outOfRange} : {}),
        referenceBaselineMs: model.referenceBaselineMs, baselineMs: snapshot.baselineMs, manualMultiplier: snapshot.manualMultiplier,
        rawLowerMs: lower, rawUpperMs: upper,
        lowerMs: lower * factor, upperMs: upper * factor, outOfRange, qualified: model.qualified};
}
function prepare(request, loaded, {transfer = true} = {}) {
    ensure(request.timingBoundary === undefined || (typeof request.timingBoundary === 'string' && /^[a-z0-9][a-z0-9_./-]{0,99}$/.test(request.timingBoundary)), 'Invalid timing boundary version');
    ensure(request.environment && Object.keys(request.environment).length > 0, 'Environment identity is required');
    ensure(typeof request.group === 'string' && request.group && typeof request.sourceFamily === 'string' && request.sourceFamily, 'Training group and source family are required');
    const environmentDigest = sha256(JSON.stringify(Object.entries(request.environment).sort()));
    const feat = features({...request, featureSchema: loaded?.model.featureSchema ?? request.featureSchema});
    const snapshot = {schemaVersion: 1, observationId: randomUUID(), ...feat, runner: request.runner, unit: request.unit,
        ...(request.timingBoundary ? {timingBoundary:request.timingBoundary} : {}),
        modelId: loaded?.id ?? null,
        selectedImplementations: feat.selectedImplementations ?? [],
        unresolvedEdges: feat.unresolvedEdges ?? [],
        group: sha256(request.group), sourceFamily: sha256(request.sourceFamily), environmentDigest,
        extraFeatures: {...request.extraFeatures},
        ...(isModernReachableSchema(feat.featureSchema) && request.backendState ? {backendState:{...request.backendState}} : {}),
        // Keep the historical training reference independent of checkpoint policy.
        // An explicit baseline remains an opt-in environment calibration.
        baselineMs: request.baselineMs ?? loaded?.model.referenceBaselineMs ?? 106638.8, manualMultiplier: request.manualMultiplier ?? 1,
        capturedAt: new Date().toISOString(), prediction: null, predictionError: null};
    if (request.sourceStore) {
        fs.mkdirSync(request.sourceStore, {recursive: true, mode: 0o700});
        snapshot.sourceArchive = request.sources.map(({name,source,role,origin}) => {
            const digest=sha256(source), file=path.join(request.sourceStore,digest);
            try {
                const fd = fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
                try {
                    ensure(fs.fstatSync(fd).isFile() && sha256(fs.readFileSync(fd))===digest,
                        'Archived training source changed or is not a regular file');
                } finally { fs.closeSync(fd); }
            } catch(error) {
                if(error.code!=='ENOENT')throw error;
                fs.writeFileSync(file,source,{flag:'wx',mode:0o600});
            }
            return {name,sha256:digest,...(role ? {role} : {}), ...(origin ? {origin} : {})};
        });
    }
    try {
        ensure(loaded, 'No model configured');
        snapshot.prediction = predict(snapshot, loaded, {shadow: true, transfer});
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
    const {accuracyMetrics, accuracyStrata} = require('./accuracy.cjs');
    const valid = rows.filter(r => r.eligible === true);
    const scored = valid.filter(r => Number.isFinite(r.prediction?.ms) && r.prediction.ms > 0);
    const groups = new Map();
    for (const row of valid) {
        const key = `${row.runner}/${row.unit}/${row.sourceFamily}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    const metrics = accuracyMetrics(valid);
    const strata = accuracyStrata(valid);
    const prefixRows = rows.filter(r => r.unit === 'prefix');
    const checkpointDecisions = prefixRows.length
        ? evaluateCheckpointDecisions(prefixRows)
        : {status: 'unmeasured', reason: 'Whole-suite durations are not shared-prefix labels'};
    return {schemaVersion: 1, status: scored.length === valid.length && valid.length > 0 ? 'scored' : 'incomplete',
        total: rows.length, eligible: valid.length, excluded: rows.length - valid.length, unpredicted: valid.length - scored.length,
        modelIds: [...new Set(scored.map(r => r.prediction.modelId))], outOfRange: scored.filter(r => r.prediction.outOfRange).length,
        ...metrics, raw: accuracyMetrics(valid, {raw: true}),
        groups: Object.fromEntries([...groups].map(([key, items]) => [key, accuracyMetrics(items)])),
        strata,
        meetsErrorTarget: metrics.meetsErrorTarget && Object.values(strata).every(dimension =>
            Object.values(dimension).every(group => group.meetsErrorTarget)),
        qualification: 'diagnostic-only; requires frozen prospective protocol and independent audit',
        checkpointDecisions};
}
const {reconcileWorkloadInputs} = require('./execution-context.cjs');
const {representWorkload, summarizeWorkloadRepresentations, WORKLOAD_REPRESENTATION_VERSION} = require('./workload-representation.cjs');
const {auditAndReextractDataset} = require('./audit.cjs');
const {PREFIX_TIMING_BOUNDARY, TEST_TIMING_BOUNDARY, validatePrefixMeasurement, recordPrefixObservation, evaluateCheckpointDecisions} = require('./prefix-measurement.cjs');
module.exports = {FEATURE_SCHEMA, WIDTH, REACHABLE_SCHEMA_V4, REACHABLE_SCHEMA_V5, REACHABLE_SCHEMA_V6, REACHABLE_SCHEMA, REACHABLE_WIDTH, sha256, features, loadModel, predict, prepare, observe, evaluate, reconcileWorkloadInputs, representWorkload, summarizeWorkloadRepresentations, WORKLOAD_REPRESENTATION_VERSION, auditAndReextractDataset, PREFIX_TIMING_BOUNDARY, TEST_TIMING_BOUNDARY, validatePrefixMeasurement, recordPrefixObservation, evaluateCheckpointDecisions};
