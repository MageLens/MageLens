// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = text => String(text).replace(/[&<>"']/g, value => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[value]));
const callbackKey = ({subject, method, phase}) => hash(JSON.stringify([subject, method, phase]));
function pluginCallback(item, area, key) {
    assert.equal(item?.family, 'plugins');
    const outcome = item.areas[area];
    assert.equal(outcome?.status, 'eligible', 'Plugin evidence for an ineligible area');
    const callback = outcome.callbacks[key];
    assert.ok(callback, 'Plugin evidence for an unknown callback');
    return {outcome, callback};
}
const cases = new Set(['baseline', 'preference-resolution', 'observer-dispatch', 'default-read', 'backend-reads', 'store-alias-read', 'website-read', 'store-read', 'store-inherits-website',
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
    const pluginMeasurement = Object.keys(manifest.plugins || {}).length > 0;
    const pluginHook = records.some(record => record.pluginHook === true);
    assert.ok(!pluginMeasurement || pluginHook, 'No functioning XML plugin execution hook observed');
    const preferenceMeasurement = Object.keys(manifest.preferences || {}).length > 0;
    const preferenceHook = records.some(record => record.preferenceHook === true);
    assert.ok(!preferenceMeasurement || preferenceHook, 'No functioning XML preference resolution hook observed');
    const requests = [];
    const warnings = [];
    for (const record of records) {
        assert.equal(record.run, manifest.run, 'Stale XML request');
        assert.equal(record.manifest, manifest.id, 'XML manifest mismatch');
        const url = new URL(record.uri || '/', 'https://application.invalid');
        let scenario = url.searchParams.get('case');
        if (!/\/blog\/index\/configuration\/?$/.test(url.pathname) || !cases.has((scenario || '').replace(/-warm$/, ''))) scenario = null;
        const events = [];
        for (const [id, areas] of Object.entries(record.ambiguousPlugins || {})) {
            assert.equal(record.pluginHook, true);
            for (const [area, callbacks] of Object.entries(areas)) for (const [key, seen] of Object.entries(callbacks)) {
                assert.equal(seen, true);
                pluginCallback(declarations.get(id), area, key).callback.ambiguousEntry = true;
            }
        }
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
            } else if (item.family === 'preferences') {
                assert.equal(record.preferenceHook, true, 'Preference evidence without a functioning request hook');
                assert.equal(event.type, 'preference-resolved');
                assert.deepEqual(Object.keys(event).sort(), ['area', 'hits', 'id', 'requested', 'type']);
                const outcome = item.areas[event.area];
                assert.equal(outcome?.status, 'eligible', 'Preference evidence for an ineligible area');
                const area = manifest.preferences?.[event.area];
                const route = area && Object.hasOwn(area.routes, event.requested) ? area.routes[event.requested] : null;
                assert.ok(route?.ids.includes(item.id) && route.resolved === outcome.resolved && outcome.origin?.id === item.id,
                    'Preference evidence does not match effective provenance');
                outcome.hits = (outcome.hits || 0) + event.hits;
                Object.assign(evidence, {area: event.area, requested: event.requested, binding: item.binding, resolved: outcome.resolved});
            } else if (item.family === 'plugins') {
                assert.equal(record.pluginHook, true, 'Plugin evidence without a functioning request hook');
                assert.equal(event.type, 'plugin-execute');
                assert.deepEqual(Object.keys(event).sort(), ['area', 'callback', 'hits', 'id', 'name', 'type']);
                assert.equal(event.name, item.registration.name);
                const {subject, method, phase} = event.callback;
                const identity = {subject, method, phase};
                assert.deepEqual(event.callback, identity);
                const {outcome, callback} = pluginCallback(item, event.area, callbackKey(identity));
                const target = manifest.plugins?.[event.area]?.[subject]?.targets?.[event.name]?.[method]?.[phase];
                assert.equal(target?.id, item.id, 'Plugin evidence does not match effective provenance');
                outcome.hits = (outcome.hits || 0) + event.hits;
                callback.hits = (callback.hits || 0) + event.hits;
                Object.assign(evidence, {area: event.area, registration: item.registration, callback: identity});
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
    const pluginTotals = {total: 0, covered: 0};
    const observerTotals = {total: 0, covered: 0};
    const preferenceTotals = {total: 0, covered: 0};
    for (const file of files) {
        if (file.reason) warnings.push({path: file.path, reason: file.reason});
        for (const item of file.declarations) {
            item.state = item.supported ? (item.hits ? 'covered' : 'uncovered') : 'unmeasured';
            if (item.areas) {
                const totals = {plugins: pluginTotals, events: observerTotals, preferences: preferenceTotals}[item.family];
                for (const [area, outcome] of Object.entries(item.areas)) {
                    outcome.hits ??= 0;
                    outcome.state = outcome.status === 'eligible' ? (outcome.hits ? 'covered' : 'uncovered') : 'unmeasured';
                    if (outcome.status === 'eligible') {
                        totals.total++;
                        if (outcome.hits) totals.covered++;
                    }
                    for (const callback of Object.values(outcome.callbacks || {})) {
                        callback.hits ??= 0;
                        callback.state = callback.hits ? 'covered' : 'uncovered';
                        if (callback.ambiguousEntry) warnings.push({path: file.path, declaration: item.id, area,
                            reason: `Unconfirmed entry to ${callback.subject}::${callback.method} (${callback.phase}) after a TypeError at the callback declaration`});
                    }
                    for (const callback of Object.values(outcome.unmeasuredCallbacks || {})) {
                        callback.state = 'unmeasured';
                        warnings.push({path: file.path, declaration: item.id, area,
                            reason: `${callback.subject}::${callback.method} (${callback.phase}) — ${callback.reason}`});
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
        const lines = file.family === 'plugins' ? [] : Object.values(file.lines).filter(line => line.state !== 'unmeasured');
        file.total = lines.length; file.covered = lines.filter(line => line.hits > 0).length;
    }
    const total = files.reduce((sum, file) => sum + file.total, 0);
    const covered = files.reduce((sum, file) => sum + file.covered, 0);
    return {schemaVersion: 1, run: manifest.run, manifest: manifest.id, complete: true, sourcesUnchanged: true,
        collectorErrors: [], observers: {...observerTotals, hook: observerHook}, plugins: {...pluginTotals, hook: pluginHook},
        preferences: {...preferenceTotals, hook: preferenceHook}, total, covered, percent: total ? covered / total * 100 : 0, warnings, files, requests};
}
const style = 'body{font:15px system-ui;margin:32px;color:#172b3a}a{color:#086b68}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{padding:5px 10px;text-align:left;border-bottom:1px solid #ddd}.covered{background:#dcefe0}.uncovered{background:#fbdada}.unmeasured{background:#eee;color:#555}.neutral{color:#555}.line{display:block}small{display:block}a:focus-visible{outline:2px solid #086b68;outline-offset:3px}td,code,small,h1{overflow-wrap:anywhere}.preferences{max-width:75rem;line-height:1.35}.preference-list,.preference-areas{list-style:none;padding:0}.preference-list>li{padding:12px 0;border-top:1px solid #ddd}.preference-areas{margin-top:6px}.preference-areas li{padding:6px 10px;margin:2px 0;overflow-wrap:anywhere}.preference-areas span{display:block}.line:target{outline:2px solid #086b68;outline-offset:-2px}@media(max-width:480px){body{margin:16px}td,th{padding:5px}.di-details,.di-details tbody,.di-details tr,.di-details td{display:block}.di-details td{border-bottom:0}.di-details tr{border-bottom:1px solid #ddd}}';
function page(title, body) { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${style}</style></head><body><h1>${escape(title)}</h1>${body}</body></html>`; }
function sourceHref(file, line, prefix = '') {
    return prefix + file.split('/').map(encodeURIComponent).join('/') + '.html#L' + line;
}
function lineLabel({startLine, endLine}) {
    return startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
}
function typeName(name) {
    return `<code>${escape(name).replaceAll('\\', '\\<wbr>')}</code>`;
}
function preferenceAreas(item, files, prefix) {
    const content = Object.entries(item.areas).map(([area, outcome]) => {
        const status = outcome.status === 'eligible' ? (outcome.hits ? 'Resolved' : 'Uncovered') : `Unmeasured · ${outcome.status}`;
        const origin = outcome.origin;
        let details = '';
        if (outcome.resolved) details += `<span>Effective type ${typeName(outcome.resolved)}</span>`;
        if (outcome.status === 'overridden' && origin) {
            const label = `${origin.path} · ${lineLabel(origin)}`;
            const provider = files.has(origin.path)
                ? `<a href="${escape(sourceHref(origin.path, origin.startLine, prefix))}">${escape(label)}</a>`
                : escape(label);
            if (outcome.effectiveReplacement !== outcome.resolved) {
                details += `<span>Effective binding to ${typeName(outcome.effectiveReplacement)}</span>`;
            }
            details += `<span>${files.has(origin.path) ? 'Effective source' : 'Effective source outside this report'} ${provider}</span>`;
        }
        if (outcome.reason && !(outcome.status === 'overridden' && origin)) details += `<small>${escape(outcome.reason)}</small>`;
        return `<li class="${outcome.state}"><strong>${escape(area)} · ${status}</strong>${details}</li>`;
    }).join('');
    return `<ul class="preference-areas">${content}</ul>`;
}
function preferenceSection(result, files) {
    const {covered, total} = result.preferences;
    const declarations = result.files.flatMap(file => file.declarations
        .filter(item => item.family === 'preferences').map(item => {
            const href = sourceHref(file.path, item.startLine);
            return `<li>${typeName(item.binding.requested)} → ${typeName(item.binding.replacement)}
                <small><a href="${escape(href)}">${escape(file.path)} · ${lineLabel(item)}</a></small>
                ${preferenceAreas(item, files, '')}</li>`;
        }));
    const content = declarations.length
        ? `<p>${covered}/${total} eligible declaration–area pairs resolved. Each eligible area counts once. Source highlights summarize all areas and sit outside the XML line totals.</p>
            ${total ? '' : '<p>All inventoried preferences are unmeasured in the supported areas.</p>'}
            <ul class="preference-list">${declarations.join('')}</ul>`
        : '<p>No preference declarations found in the XML source inventory.</p>';
    return `<section class="preferences" aria-labelledby="preference-usage"><h2 id="preference-usage">Preference usage</h2>${content}</section>`;
}
function writeReport(result, sources, directory = 'coverage/xml') {
    fs.mkdirSync(directory, {recursive: true});
    const directories = new Map([['', new Map()]]);
    const files = new Set(result.files.map(file => file.path));
    for (const file of result.files) {
        const target = path.join(directory, file.path + '.html');
        fs.mkdirSync(path.dirname(target), {recursive: true});
        const lines = sources[file.path].toString().split('\n').map((text, index) => {
            const line = index + 1, state = file.lines[line]?.state || 'neutral';
            return `<span id="L${line}" class="line ${state}" data-state="${state}"><a href="#L${line}">${line}</a> ${escape(text)}</span>`;
        }).join('');
        const prefix = '../'.repeat(file.path.split('/').length - 1);
        const details = file.declarations.map(item => {
            if (item.family === 'preferences') {
                return `<tr><td><a href="#L${item.startLine}">${typeName(item.binding.requested)}</a> → ${typeName(item.binding.replacement)}
                    <small>Original ${lineLabel(item)}</small></td><td>${preferenceAreas(item, files, prefix)}</td></tr>`;
            }
            const outcomes = item.areas
                ? Object.entries(item.areas).map(([area, outcome]) => {
                    const callbacks = [...Object.values(outcome.callbacks || {}), ...Object.values(outcome.unmeasuredCallbacks || {})].map(callback =>
                        `<small>${escape(callback.subject)}::${escape(callback.method)} · ${escape(callback.phase)} · ${escape(callback.state)}${callback.ambiguousEntry ? ' · entry could not be confirmed for a TypeError' : ''}${callback.reason ? ' · ' + escape(callback.reason) : ''}</small>`).join('');
                    return `<small>${escape(area)} · ${escape(outcome.status === 'eligible' ? outcome.state : outcome.status)}${outcome.reason ? ' · ' + escape(outcome.reason) : ''}</small>${callbacks}`;
                }).join('')
                : `<small>${escape(item.reason || (item.effective ? 'effective' : 'shadowed or externally overridden'))}</small>`;
            const type = {events: 'Observer execution', plugins: 'Plugin execution'}[item.family] || item.state;
            return `<tr><td><a href="#L${item.startLine}">${escape(item.path)}</a><small>${escape(item.declaredScope.type)} ${escape(item.declaredScope.code)} · lines ${item.startLine}–${item.endLine}</small></td><td>${escape(type)}${outcomes}</td></tr>`;
        }).join('');
        fs.writeFileSync(target, page(file.path, `<p><a href="index.html">Directory</a> · ${file.family === 'plugins' ? 'DI declarations by area' : `${file.covered}/${file.total} supported lines covered`}</p><p>${escape(file.reason || '')}</p><table${file.family === 'plugins' ? ' class="di-details"' : ''}>${details}</table><pre>${lines}</pre>`));
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
        const top = name ? '<p><a href="../index.html">Parent directory</a></p>' : `<p>${result.covered}/${result.total} supported lines covered (${result.percent.toFixed(2)}%). <a href="coverage.json">JSON</a></p><p>${result.observers.covered}/${result.observers.total} eligible observer registrations executed across areas.</p><p>${result.plugins.covered}/${result.plugins.total} eligible plugin registrations executed across areas. Each declaration contributes once per eligible area; its source highlight summarizes all areas and is excluded from line totals.</p><p>Green: observed during a config read, Admin field render, observer execution, plugin execution or preference resolution. Red: eligible and unobserved. Grey: unmeasured. XML loading grants no credit. Section/group wrappers are neutral. ${result.warnings.length} measurement warnings; inspect source details and JSON.</p>`;
        fs.mkdirSync(path.join(directory, name), {recursive: true});
        fs.writeFileSync(path.join(directory, name, 'index.html'), page(name || 'XML configuration coverage', top + `<table>${rows}</table>` + (name ? '' : preferenceSection(result, files))));
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
