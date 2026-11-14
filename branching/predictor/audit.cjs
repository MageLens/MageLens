// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const REACHABLE_SCHEMA = 'syntax-reachable-v6-babel-7.29.9';
const {PLAYWRIGHT_TEST_TIMING_BOUNDARY,TEST_TIMING_BOUNDARY,PREFIX_TIMING_BOUNDARY,SEGMENT_TIMING_BOUNDARY} =
    require('./prefix-measurement.cjs');
const testBoundaries = new Map([['cypress',TEST_TIMING_BOUNDARY],['playwright',PLAYWRIGHT_TEST_TIMING_BOUNDARY]]);

function auditAndReextractDataset(datasetPath, sourceStorePath, options = {}) {
    const raw = fs.readFileSync(datasetPath, 'utf8');
    const inputDigest = sha256(raw);
    const rows = JSON.parse(raw);
    const targetSchema = options.targetSchema ?? REACHABLE_SCHEMA;
    const featuresFn = options.features ?? require('./index.cjs').features;

    const auditedRows = [];
    const quarantinedRows = [];
    const missingSourceHashes = new Set();
    const sourceFamilyCounts = {};

    for (const [index, row] of rows.entries()) {
        if (row.measurementKind === 'source-fragment-diagnostic') {
            quarantinedRows.push({
                index,
                observationId: row.observationId ?? null,
                reason: 'Source fragment diagnostic lacks a complete execution audit'
            });
            continue;
        }
        const archive = row.sourceArchive ?? [];
        if (!archive.length) {
            quarantinedRows.push({
                index,
                observationId: row.observationId ?? null,
                reason: 'Missing sourceArchive metadata'
            });
            continue;
        }

        const sources = [];
        const missing = [];
        const invalid = [];
        const names = new Set();
        for (const entry of archive) {
            if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
                typeof entry.name !== 'string' || !entry.name || names.has(entry.name)) {
                invalid.push('Invalid or duplicate source metadata');
                continue;
            }
            names.add(entry.name);
            const file = path.join(sourceStorePath, entry.sha256);
            try {
                const stat = fs.lstatSync(file);
                if (!stat.isFile() || stat.isSymbolicLink()) {
                    invalid.push(`Source is not a regular file: ${entry.sha256}`);
                    continue;
                }
                const bytes = fs.readFileSync(file);
                if (sha256(bytes) !== entry.sha256) {
                    invalid.push(`Source hash mismatch: ${entry.sha256}`);
                    continue;
                }
                sources.push({name: entry.name, role: entry.role ?? 'work', source: bytes.toString('utf8'), ...(entry.origin ? {origin: entry.origin} : {})});
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                missing.push(entry);
                missingSourceHashes.add(entry.sha256);
            }
        }
        if (missing.length || invalid.length) {
            quarantinedRows.push({
                index,
                observationId: row.observationId ?? null,
                reason: invalid.length ? invalid.join('; ') : `Incomplete source archive (${missing.length} missing sources)`,
                missingFiles: missing.map(s => ({name: s.name, sha256: s.sha256}))
            });
            continue;
        }

        const input = {
            runner: row.runner,
            unit: row.unit,
            sources,
            extraFeatures: row.extraFeatures ?? {},
            backendState: row.backendState
        };
        let reextracted;
        try {
            if (row.eligible !== true || !Number.isFinite(row.actualMs) || row.actualMs <= 0)
                throw new Error('Ineligible timing observation');
            if (row.measurementKind === 'retained-provider-segment' &&
                (!row.executionSegmentId || !/^[a-f0-9]{64}$/.test(row.forecastDigest ?? '') ||
                    row.observationId !== require('../identity.cjs').digest([row.forecastDigest, row.executionSegmentId]) ||
                    row.timingBoundary !== SEGMENT_TIMING_BOUNDARY ||
                    row.actualMs !== row.timings?.prefixWorkMs || !Number.isFinite(row.timings?.wallTimeMs) ||
                    row.timings.wallTimeMs < row.actualMs))
                throw new Error('Incomplete retained-provider timing evidence');
            if (!row.featureSchema || !row.sourceDigest ||
                featuresFn({...input,featureSchema:row.featureSchema}).sourceDigest !== row.sourceDigest)
                throw new Error('Archived corpus differs from the recorded source digest');
            if ((row.unit === 'test' && (!testBoundaries.has(row.runner) || testBoundaries.get(row.runner) !== row.timingBoundary)) ||
                (row.unit === 'prefix' && ![PREFIX_TIMING_BOUNDARY,SEGMENT_TIMING_BOUNDARY].includes(row.timingBoundary)))
                throw new Error('Unsupported or missing timing boundary provenance');
            reextracted = featuresFn({...input,featureSchema:targetSchema});
        } catch (error) {
            quarantinedRows.push({
                index,
                observationId: row.observationId ?? null,
                reason: `Re-extraction failed: ${error.message}`
            });
            continue;
        }

        const {prediction, predictionError, modelId, errorMs, ...measurement} = row;
        const updatedRow = {
            ...measurement,
            featureSchema: targetSchema,
            vector: reextracted.vector,
            sourceDigest: reextracted.sourceDigest,
            selectedImplementations: reextracted.selectedImplementations,
            unresolvedEdges: reextracted.unresolvedEdges,
            registeredCalls: reextracted.registeredCalls ?? [],
            processCalls: reextracted.processCalls ?? [],
            originalForecast: row.originalForecast ?? {featureSchema:row.featureSchema,sourceDigest:row.sourceDigest,
                modelId,prediction,predictionError,errorMs},
            reextractedAt: new Date().toISOString()
        };

        auditedRows.push(updatedRow);
        sourceFamilyCounts[row.sourceFamily] = (sourceFamilyCounts[row.sourceFamily] || 0) + 1;
    }

    const provenance = {
        schemaVersion: 1,
        inputDataset: path.resolve(datasetPath),
        inputDatasetDigest: inputDigest,
        targetSchema,
        totalAudited: rows.length,
        retainedCount: auditedRows.length,
        quarantinedCount: quarantinedRows.length,
        missingSourceHashCount: missingSourceHashes.size,
        missingSourceHashes: [...missingSourceHashes].sort(),
        sourceFamilyDistribution: sourceFamilyCounts,
        groups: [...new Set(auditedRows.map(r => r.group))].length,
        quarantinedDetails: quarantinedRows,
        auditedAt: new Date().toISOString()
    };

    return {
        rows: auditedRows,
        provenance
    };
}

module.exports = {auditAndReextractDataset};
