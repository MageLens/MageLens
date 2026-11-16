// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = text => String(text).replace(/[&<>"']/g, value => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[value]));
const cases = new Set(['baseline', 'observer-dispatch', 'default-read', 'backend-reads', 'store-alias-read', 'website-read', 'store-read', 'store-inherits-website',
    'store-inherits-default', 'website-inherits-default', 'database-override', 'value-reads', 'subtree-read',
    'missing-read', 'warmup-only']);
function merge(manifest, records, sources) {
    const declarations = new Map(), files = structuredClone(manifest.files);
    for (const file of files) {
        assert.match(file.path, /^(app\/code|app\/design|vendor)\//);
        assert.ok(!file.path.split('/').some(part => part === '..' || part === '.'));
        assert.equal(hash(sources[file.path]), file.sourceHash, `XML source changed: ${file.path}`);
        file.sourceFingerprint = hash(sources[file.path].toString().replaceAll('\r\n', '\n'));
        file.lines = {};
        for (const item of file.declarations) {
            assert.ok(!declarations.has(item.id), 'Duplicate XML declaration');
            declarations.set(item.id, item);
            item.hits = 0; item.evidence = [];
        }
    }
    assert.ok(records.length && records.some(record => record.readHook), 'No functioning XML config-read hook observed');
    const observerMeasurement = Object.keys(manifest.observers || {}).length > 0;
    const observerHook = records.some(record => record.observerHook === true);
    assert.ok(!observerMeasurement || observerHook, 'No functioning XML observer execution hook observed');
    const requests = [];
    for (const record of records) {
        assert.equal(record.run, manifest.run, 'Stale XML request');
        assert.equal(record.manifest, manifest.id, 'XML manifest mismatch');
        const url = new URL(record.uri || '/', 'https://application.invalid');
        let scenario = url.searchParams.get('case');
        if (!/\/blog\/index\/configuration\/?$/.test(url.pathname) || !cases.has((scenario || '').replace(/-warm$/, ''))) scenario = null;
        const events = [];
        for (const event of record.events) {
            const item = declarations.get(event.id);
            assert.ok(item?.supported, 'Unknown or unmeasured XML evidence');
            assert.ok(Number.isSafeInteger(event.hits) && event.hits > 0);
            const evidence = {run: record.run, request: record.request, type: event.type};
            if (item.family === 'events') {
                assert.ok(record.observerHook === true, 'Observer evidence without a functioning request hook');
                assert.equal(event.type, 'observer-execute');
                assert.deepEqual(event.registration, item.registration);
                assert.equal(item.areas[event.area]?.status, 'eligible', 'Observer evidence for an ineligible area');
                const target = manifest.observers?.[event.area]?.[event.registration.event]?.targets?.[event.registration.observer];
                assert.equal(target?.id, item.id, 'Observer evidence does not match effective provenance');
                item.areas[event.area].hits = (item.areas[event.area].hits || 0) + event.hits;
                Object.assign(evidence, {area: event.area, registration: item.registration});
            } else {
                assert.equal(event.type, item.family === 'config' ? 'config-read' : 'system-field-render');
                assert.ok(['default', 'websites', 'stores'].includes(event.requestedScope.type));
                assert.equal(typeof event.requestedScope.code, 'string');
                evidence.requestedScope = event.requestedScope;
            }
            item.hits += event.hits;
            if (!item.evidence.some(previous => JSON.stringify(previous) === JSON.stringify(evidence))) item.evidence.push(evidence);
            events.push(event);
        }
        if (events.length || scenario) requests.push({id: record.request, case: scenario, events});
    }
    const warnings = [];
    const observerTotals = {total: 0, covered: 0};
    for (const file of files) {
        if (file.reason) warnings.push({path: file.path, reason: file.reason});
        for (const item of file.declarations) {
            item.state = item.supported ? (item.hits ? 'covered' : 'uncovered') : 'unmeasured';
            if (item.family === 'events') {
                for (const [area, outcome] of Object.entries(item.areas)) {
                    outcome.hits ??= 0;
                    outcome.state = outcome.status === 'eligible' ? (outcome.hits ? 'covered' : 'uncovered') : 'unmeasured';
                    if (outcome.status === 'eligible') {
                        observerTotals.total++;
                        if (outcome.hits) observerTotals.covered++;
                    }
                    if (['ambiguous', 'unsupported'].includes(outcome.status)) {
                        warnings.push({path: file.path, declaration: item.id, area, reason: outcome.reason});
                    }
                }
            } else if (!item.supported) warnings.push({path: file.path, declaration: item.id, reason: item.reason});
            for (let line = item.startLine; line <= item.endLine; line++) {
                const previous = file.lines[line];
                const hits = (previous?.hits || 0) + item.hits;
                const supported = item.supported || previous?.state === 'uncovered' || previous?.state === 'covered';
                file.lines[line] = {hits, state: supported ? (hits ? 'covered' : 'uncovered') : 'unmeasured'};
            }
        }
        const lines = Object.values(file.lines).filter(line => line.state !== 'unmeasured');
        file.total = lines.length; file.covered = lines.filter(line => line.hits > 0).length;
    }
    const total = files.reduce((sum, file) => sum + file.total, 0);
    const covered = files.reduce((sum, file) => sum + file.covered, 0);
    return {schemaVersion: 1, run: manifest.run, manifest: manifest.id, complete: true, sourcesUnchanged: true,
        collectorErrors: [], observers: {...observerTotals, hook: observerHook}, total, covered, percent: total ? covered / total * 100 : 0, warnings, files, requests};
}
const style = 'body{font:15px system-ui;margin:32px;color:#172b3a}a{color:#086b68}pre{margin:0;white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{padding:5px 10px;text-align:left;border-bottom:1px solid #ddd}.covered{background:#dcefe0}.uncovered{background:#fbdada}.unmeasured{background:#eee;color:#555}.neutral{color:#555}.line{display:block}small{display:block}';
function page(title, body) { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${style}</style></head><body><h1>${escape(title)}</h1>${body}</body></html>`; }
function writeReport(result, sources, directory = 'coverage/xml') {
    fs.mkdirSync(directory, {recursive: true});
    const directories = new Map([['', new Map()]]);
    for (const file of result.files) {
        const target = path.join(directory, file.path + '.html');
        fs.mkdirSync(path.dirname(target), {recursive: true});
        const lines = sources[file.path].toString().split('\n').map((text, index) => {
            const line = index + 1, state = file.lines[line]?.state || 'neutral';
            return `<span id="L${line}" class="line ${state}" data-state="${state}"><a href="#L${line}">${line}</a> ${escape(text)}</span>`;
        }).join('');
        const details = file.declarations.map(item => {
            const outcomes = item.family === 'events'
                ? Object.entries(item.areas).map(([area, outcome]) => `<small>${escape(area)} · ${escape(outcome.status === 'eligible' ? outcome.state : outcome.status)}${outcome.reason ? ' · ' + escape(outcome.reason) : ''}</small>`).join('')
                : `<small>${escape(item.reason || (item.effective ? 'effective' : 'shadowed or externally overridden'))}</small>`;
            return `<tr><td><a href="#L${item.startLine}">${escape(item.path)}</a><small>${escape(item.declaredScope.type)} ${escape(item.declaredScope.code)} · lines ${item.startLine}–${item.endLine}</small></td><td>${item.family === 'events' ? 'Observer execution' : escape(item.state)}${outcomes}</td></tr>`;
        }).join('');
        fs.writeFileSync(target, page(file.path, `<p><a href="index.html">Directory</a> · ${file.covered}/${file.total} supported lines covered</p><p>${escape(file.reason || '')}</p><table>${details}</table><pre>${lines}</pre>`));
        let parent = path.posix.dirname(file.path);
        if (!directories.has(parent)) directories.set(parent, new Map());
        directories.get(parent).set(path.posix.basename(file.path) + '.html', {label: path.posix.basename(file.path), file});
        while (parent !== '.') {
            const child = path.posix.basename(parent), ancestor = path.posix.dirname(parent);
            const key = ancestor === '.' ? '' : ancestor;
            if (!directories.has(key)) directories.set(key, new Map());
            directories.get(key).set(child + '/index.html', {label: child + '/'});
            parent = ancestor;
        }
    }
    for (const [name, entries] of directories) {
        const rows = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([href, entry]) => `<tr><td><a href="${escape(href)}">${escape(entry.label)}</a></td><td>${entry.file ? `${entry.file.covered}/${entry.file.total}` : ''}</td></tr>`).join('');
        const top = name ? '<p><a href="../index.html">Parent directory</a></p>' : `<p>${result.covered}/${result.total} supported lines covered (${result.percent.toFixed(2)}%). <a href="coverage.json">JSON</a></p><p>${result.observers.covered}/${result.observers.total} eligible observer registrations executed across areas.</p><p>Green: observed during a config read, Admin field render or observer execution. Red: eligible and unobserved. Grey: unmeasured. XML loading grants no credit. Section/group wrappers are neutral. ${result.warnings.length} measurement warnings; inspect source details and JSON.</p>`;
        fs.mkdirSync(path.join(directory, name), {recursive: true});
        fs.writeFileSync(path.join(directory, name, 'index.html'), page(name || 'XML configuration coverage', top + `<table>${rows}</table>`));
    }
    fs.writeFileSync(path.join(directory, 'coverage.json'), JSON.stringify(result, null, 2));
}
function report() {
    const read = file => JSON.parse(fs.readFileSync(file));
    assert.equal(fs.existsSync('coverage/.active-run'), false, 'Stop and drain collection before XML reporting');
    const run = read('coverage/run.json'), manifest = read('coverage/xml-manifest.json');
    assert.equal(run.id, manifest.run);
    const raw = `coverage/raw/php/${run.id}`;
    assert.ok(!fs.readdirSync(raw).some(file => file.endsWith('.error')), 'Failed HTTP collection');
    const metadata = fs.readdirSync(raw).filter(file => /^[a-f0-9]+\.json$/.test(file));
    const records = metadata.map(file => {
        const request = read(`${raw}/${file}`);
        assert.ok(request.xml, 'Missing XML request evidence');
        return {...request.xml, uri: request.uri, request: file.slice(0, -5)};
    });
    const sources = Object.fromEntries(manifest.files.map(file => [file.path, fs.readFileSync(`src/${file.path}`)]));
    const result = merge(manifest, records, sources);
    writeReport(result, sources);
    return result;
}
module.exports = {merge, writeReport, report};
if (require.main === module) report();
