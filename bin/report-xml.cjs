// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {startFamilyDeclaration, observeFamilyEffect, familyWarnings, familyOutcomes} = require('./xml-family-report.cjs');
const {correlateBrowserEvidence, readXmlBrowserEvidence, browserEffects} = require('./xml-browser-evidence.cjs');
const {createHash} = require('node:crypto');
const {layoutEvents, layoutDecisions, layoutObservations, layoutLimitations, countsAsLayoutCoverage} = require('./xml-report/layout/index.cjs');
const {BLOG_CONFIGURATION_ROUTE, WARM_REQUEST_SUFFIX, XML_REQUEST_METADATA} = require('./xml-report/regex.cjs');
const {assertSourcePath, readSources} = require('./xml-report/source-files.cjs');
const {escapeHtml: escape} = require('./report-index.cjs');
const {formatPercent} = require('./badges.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
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
const diFamilies = {
    'virtual-types': {key: 'virtualTypes', title: 'Virtual type usage', event: 'virtual-type-resolved', action: 'resolved'},
    arguments: {key: 'arguments', title: 'Constructor argument usage', event: 'argument-applied', action: 'applied'},
    lifecycles: {key: 'lifecycles', title: 'Object lifetime usage', event: 'lifetime-applied', action: 'applied'},
};
function merge(manifest, records, sources, browserObservations = []) {
    const declarations = new Map(), files = structuredClone(manifest.files);
    for (const file of files) {
        assertSourcePath(file.path);
        assert.equal(hash(sources[file.path]), file.sourceHash, `XML source changed: ${file.path}`);
        file.sourceFingerprint = hash(sources[file.path].toString().replaceAll('\r\n', '\n'));
        file.lines = {};
        for (const item of file.declarations) {
            assert.ok(!declarations.has(item.id), 'Duplicate XML declaration');
            declarations.set(item.id, {item, source: file.path});
            item.hits = 0; item.evidence = [];
            if (item.effects) startFamilyDeclaration(item);
        }
    }
    const browser = correlateBrowserEvidence(manifest.run, records, new Map([...declarations].map(([id, {item}]) => [id, item])), browserObservations);
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
    const diTotals = {};
    for (const [family, details] of Object.entries(diFamilies)) {
        const enabled = Object.values(manifest.preferences || {}).some(area => Object.keys(area.diUsage?.eligible?.[family] || {}).length);
        const hook = records.some(record => record.diUsageHooks?.[family] === true);
        assert.ok(!enabled || hook, `No functioning XML ${details.title.toLowerCase()} hook observed`);
        diTotals[family] = {total: 0, covered: 0, hook};
    }
    const layoutHook = records.some(record => record.layoutHook === true);
    const limitedHandles = new Map();
    const layoutTotals = {total: 0, covered: 0, hook: layoutHook, limitations: []};
    const layoutMeasurement = [...declarations.values()].some(({item}) => item.family === 'layout' && item.supported);
    assert.ok(!layoutMeasurement || layoutHook || records.every(record => record.layoutRequired === false),
        'No functioning XML layout hook observed');
    const requestLimitations = new Set();
    const requests = [];
    const commands = new Map();
    const warnings = [];
    for (const record of records) {
        assert.equal(record.run, manifest.run, 'Stale XML request');
        assert.equal(record.manifest, manifest.id, 'XML manifest mismatch');
        const url = new URL(record.uri || '/', 'https://application.invalid');
        let scenario = url.searchParams.get('case');
        if (!BLOG_CONFIGURATION_ROUTE.test(url.pathname) || !cases.has((scenario || '').replace(WARM_REQUEST_SUFFIX, ''))) scenario = null;
        const events = [];
        const argumentApplications = new Set(record.events.filter(event => event.type === 'layout-argument-applied')
            .map(event => JSON.stringify([event.id, event.area, event.theme])));
        const layoutEffectHits = new Map();
        const layoutEffectKey = (id, type, area, theme) => JSON.stringify([id, type, area, theme]);
        for (const event of record.events) if (event.type?.startsWith('layout-')) {
            const key = layoutEffectKey(event.id, event.type, event.area, event.theme);
            layoutEffectHits.set(key, (layoutEffectHits.get(key) || 0) + event.hits);
        }
        for (const limitation of record.layoutLimitations || []) {
            assert.ok(Object.hasOwn(layoutLimitations, limitation), 'Unknown layout measurement limitation');
            requestLimitations.add(limitation);
        }
        for (const {reason, area, handles} of record.layoutScopedLimitations || []) {
            assert.ok(['layout-package-cache', 'layout-merge-cache', 'scheduled-layout-cache', 'missing-layout-origins'].includes(reason)
                && record.layoutLimitations?.includes(reason), 'Unexpected scoped layout limitation');
            assert.ok(['frontend', 'adminhtml'].includes(area));
            assert.ok(Array.isArray(handles) && handles.length && new Set(handles).size === handles.length, 'Invalid limited layout handles');
            for (const handle of handles) {
                assert.ok(typeof handle === 'string' && handle, 'Invalid layout handle');
                const key = JSON.stringify([area, handle]);
                if (!limitedHandles.has(key)) limitedHandles.set(key, new Set());
                limitedHandles.get(key).add(reason);
            }
        }
        for (const [id, areas] of Object.entries(record.ambiguousPlugins || {})) {
            assert.equal(record.pluginHook, true);
            for (const [area, callbacks] of Object.entries(areas)) for (const [key, seen] of Object.entries(callbacks)) {
                assert.equal(seen, true);
                pluginCallback(declarations.get(id)?.item, area, key).callback.ambiguousEntry = true;
            }
        }
        const observations = [...record.events.map(event => ({event})), ...(browser.get(record) || [])];
        for (const {event, evidence: browserEvidence} of observations) {
            assert.ok(Boolean(browserEvidence) === browserEffects.has(event.type), 'Unexpected browser XML observation origin');
            const declaration = declarations.get(event.id);
            const {item, source} = declaration ?? {};
            assert.ok(item?.supported || (item?.family === 'layout' && item.layout.kind === 'file-selection'), 'Unknown or unmeasured XML evidence');
            assert.ok(Number.isSafeInteger(event.hits) && event.hits > 0);
            const evidence = {run: record.run, request: record.request, type: event.type, ...browserEvidence};
            let covers = true;
            if (item.effects) {
                covers = observeFamilyEffect(item, event, evidence);
            } else if (item.family === 'events') {
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
            } else if (Object.hasOwn(diFamilies, item.family)) {
                assert.equal(record.diUsageHooks?.[item.family], true, 'DI evidence without a functioning request hook');
                assert.equal(event.type, diFamilies[item.family].event);
                assert.deepEqual(Object.keys(event).sort(), ['area', 'hits', 'id', 'requested', 'type']);
                assert.ok(typeof event.requested === 'string' && event.requested);
                const outcome = item.areas[event.area];
                const usage = manifest.preferences?.[event.area]?.diUsage;
                assert.equal(outcome?.status, 'eligible', 'DI evidence for an ineligible area');
                assert.equal(outcome.origin?.id, item.id, 'DI evidence does not match the source declaration');
                assert.equal(usage?.eligible?.[item.family]?.[item.id], true, 'DI evidence does not match effective provenance');
                if (item.family === 'virtual-types') {
                    const route = Object.hasOwn(usage.virtualRoutes || {}, event.requested) ? usage.virtualRoutes[event.requested] : null;
                    assert.ok(route?.ids.includes(item.id) && route.resolved === outcome.resolved, 'Virtual type evidence does not match the factory route');
                }
                outcome.hits = (outcome.hits || 0) + event.hits;
                Object.assign(evidence, {area: event.area, requested: event.requested, binding: item.binding, resolved: outcome.resolved});
            } else if (item.family === 'layout') {
                assert.ok(record.layoutHook === true || item.layout.kind === 'file-selection', 'Layout evidence without a functioning request hook');
                assert.deepEqual(Object.keys(event).sort(), ['area', 'hits', 'id', 'theme', 'type']);
                assert.ok(layoutEvents[item.layout.kind]?.includes(event.type), 'Unexpected layout effect');
                assert.ok(['frontend', 'adminhtml'].includes(event.area), 'Unexpected layout evidence area');
                assert.ok(typeof event.theme === 'string' && event.theme.startsWith(event.area + '/'), 'Unexpected layout theme');
                assert.equal(manifest.layoutSources?.[source]?.targets[item.layout.ordinal]?.ids[item.layout.kind],
                    item.id, 'Layout evidence does not match manifest provenance');
                if (event.type === 'layout-argument-read') {
                    assert.ok(argumentApplications.has(JSON.stringify([event.id, event.area, event.theme])),
                        'Argument read without native application evidence');
                }
                const target = manifest.layoutSources?.[source]?.targets[item.layout.ordinal];
                for (const [valueKind, nameKind, valueType, nameType] of [
                    ['argument', 'argument-name', 'layout-argument-applied', 'layout-argument-name-applied'],
                    ['action-argument', 'action-argument-name', 'layout-action-argument-applied', 'layout-action-argument-name-applied'],
                ]) {
                    const valueHits = layoutEffectHits.get(layoutEffectKey(target?.ids[valueKind], valueType, event.area, event.theme));
                    const nameHits = layoutEffectHits.get(layoutEffectKey(target?.ids[nameKind], nameType, event.area, event.theme));
                    if (item.layout.kind === nameKind && event.type === nameType) {
                        assert.ok(valueHits > 0 && valueHits === nameHits, 'Argument name application without matching native value evidence');
                    }
                    if (item.layout.kind === valueKind && event.type === valueType && target?.ids[nameKind]) {
                        assert.ok(nameHits > 0 && valueHits === nameHits, 'Native value application without matching argument name evidence');
                    }
                }
                Object.assign(evidence, {area: event.area, theme: event.theme});
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
            if (covers && (item.family !== 'layout' || countsAsLayoutCoverage(event.type))) item.hits += event.hits;
            const key = item.family === 'layout'
                ? JSON.stringify([evidence.type, evidence.area, evidence.theme])
                : JSON.stringify(evidence);
            const evidenceKeys = declaration.evidenceKeys ??= new Set();
            if (!evidenceKeys.has(key)) {
                evidenceKeys.add(key);
                item.evidence.push(evidence);
            }
            events.push(event);
        }
        const limitations = [...new Set(record.layoutLimitations || [])].sort().map(key => layoutLimitations[key]);
        if (events.length || scenario || limitations.length) {
            const command = record.tool && commands.get(record.request);
            if (command) {
                assert.equal(command.tool, record.tool);
                command.events.push(...events);
                if (limitations.length) {
                    command.layoutLimitations = [...new Set([...(command.layoutLimitations || []), ...limitations])].sort();
                }
            } else {
                const request = {id: record.request, case: scenario, ...(record.tool ? {tool: record.tool} : {}), events,
                    ...(limitations.length ? {layoutLimitations: limitations} : {})};
                requests.push(request);
                if (record.tool) commands.set(record.request, request);
            }
        }
    }
    const pluginTotals = {total: 0, covered: 0};
    const observerTotals = {total: 0, covered: 0};
    const preferenceTotals = {total: 0, covered: 0};
    for (const file of files) {
        if (file.reason) warnings.push({path: file.path, reason: file.reason});
        for (const item of file.declarations) {
            item.state = item.supported ? (item.hits ? 'covered' : 'uncovered') : 'unmeasured';
            if (item.effects) warnings.push(...familyWarnings(item, file.path));
            if (item.family === 'layout') {
                const decisions = new Set(item.evidence.map(event => layoutDecisions[event.type]).filter(Boolean));
                if (item.state === 'uncovered' && ['page', 'generic'].includes(item.layout.fileType)) {
                    // Theme fallback and replacement cannot be inferred from a cache key.
                    if (file.layoutProvider ? file.layoutProvider.type === 'module' : /^(?:app\/code\/|vendor\/[^/]+\/[^/]+\/.*view\/)/.test(file.path)) {
                        const areas = item.declaredScope.type === 'base' ? ['frontend', 'adminhtml'] : [item.declaredScope.type];
                        for (const area of areas) {
                            for (const key of limitedHandles.get(JSON.stringify([area, item.layout.handle])) || []) {
                                decisions.add(layoutLimitations[key]);
                            }
                        }
                    }
                }
                if (item.supported && decisions.size) {
                    item.reason = [...decisions].sort().map(reason => reason.replace(/\.$/, '')).join('. ');
                    if (!item.hits) item.state = 'unmeasured';
                }
                if (item.state !== 'unmeasured') layoutTotals.total++;
                if (item.state === 'covered') layoutTotals.covered++;
                if (item.state === 'unmeasured' || decisions.size) warnings.push({path: file.path, declaration: item.id, reason: item.reason});
            } else if (item.areas) {
                const totals = {plugins: pluginTotals, events: observerTotals, preferences: preferenceTotals, ...diTotals}[item.family];
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
            for (let line = item.startLine; line <= (item.highlightEndLine ?? item.endLine); line++) {
                const previous = file.lines[line];
                const hits = (previous?.hits || 0) + item.hits;
                const supported = item.state !== 'unmeasured' || previous?.state === 'uncovered' || previous?.state === 'covered';
                file.lines[line] = {hits, state: supported ? (hits ? 'covered' : 'uncovered') : 'unmeasured'};
            }
        }
        const lines = Object.values(file.lines).filter(line => line.state !== 'unmeasured');
        file.total = lines.length; file.covered = lines.filter(line => line.hits > 0).length;
    }
    layoutTotals.limitations = [...requestLimitations].sort().map(key => layoutLimitations[key]);
    const total = files.reduce((sum, file) => sum + file.total, 0);
    const covered = files.reduce((sum, file) => sum + file.covered, 0);
    return {schemaVersion: 1, run: manifest.run, manifest: manifest.id, complete: true, sourcesUnchanged: true,
        collectorErrors: [], observers: {...observerTotals, hook: observerHook}, plugins: {...pluginTotals, hook: pluginHook},
        preferences: {...preferenceTotals, hook: preferenceHook}, layout: layoutTotals,
        ...Object.fromEntries(Object.entries(diFamilies).map(([family, details]) => [details.key, diTotals[family]])),
        total, covered, percent: total ? covered / total * 100 : null, warnings, files, requests};
}
const stylesheet = 'report.css';
const encodedPath = source => source.split('/').map(encodeURIComponent).join('/');
function page(source, body, isFile = false) {
    const parts = source ? source.split('/') : [];
    const parents = isFile ? parts.slice(0, -1) : parts;
    const prefix = '../'.repeat(parents.length);
    const breadcrumbs = parents.map((name, index) => !isFile && index === parents.length - 1
        ? `<span aria-current="page">${escape(name)}</span>`
        : `<a href="${'../'.repeat(parents.length - index - 1)}index.html">${escape(name)}</a>`);
    if (isFile) breadcrumbs.push(`<span aria-current="page">${escape(parts.at(-1))}</span>`);
    const root = source ? `<a href="${prefix}index.html">All XML files</a>` : '<span aria-current="page">All XML files</span>';
    const title = source || 'XML configuration coverage';
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><link rel="stylesheet" href="${prefix}${stylesheet}"></head>
<body><nav aria-label="Breadcrumb"><a href="${prefix}../index.html">Coverage report</a> / ${[root, ...breadcrumbs].join(' / ')}</nav>
<main><h1>${escape(title)}</h1>${body}</main></body></html>`;
}

function sourceHref(file, line, prefix = '') {
    return prefix + encodedPath(file) + '.html#L' + line;
}
function lineLabel({startLine, endLine}) {
    return startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
}
function typeName(name) {
    return `<code>${escape(name).replaceAll('\\', '\\<wbr>')}</code>`;
}
function preferenceAreas(item, files, prefix) {
    const content = Object.entries(item.areas).map(([area, outcome]) => {
        const action = diFamilies[item.family]?.action || 'resolved';
        const status = outcome.status === 'eligible'
            ? (outcome.hits ? action[0].toUpperCase() + action.slice(1) : 'Uncovered') : `Unmeasured · ${outcome.status}`;
        const origin = outcome.origin;
        let details = '';
        if (outcome.resolved) details += `<span>Effective type ${typeName(outcome.resolved)}</span>`;
        if (action === 'applied' && outcome.hits) {
            const types = [...new Set(item.evidence.filter(event => event.area === area).map(event => event.requested))].sort();
            if (types.length) details += `<details><summary>Applied for ${types.length} requested ${types.length === 1 ? 'type' : 'types'}</summary>
                ${types.map(type => `<span>${typeName(type)}</span>`).join('')}</details>`;
        }
        if (outcome.status === 'overridden' && origin) {
            const label = `${origin.path} · ${lineLabel(origin)}`;
            const provider = files.has(origin.path)
                ? `<a href="${escape(sourceHref(origin.path, origin.startLine, prefix))}">${escape(label)}</a>`
                : escape(label);
            if (outcome.effectiveReplacement && outcome.effectiveReplacement !== outcome.resolved) {
                details += `<span>Effective binding to ${typeName(outcome.effectiveReplacement)}</span>`;
            }
            details += `<span>${files.has(origin.path) ? 'Effective source' : 'Effective source outside this report'} ${provider}</span>`;
        }
        if (outcome.reason && !(outcome.status === 'overridden' && origin)) details += `<small>${escape(outcome.reason)}</small>`;
        return `<li class="${outcome.state}"><strong>${escape(area)} · ${status}</strong>${details}</li>`;
    }).join('');
    return `<ul class="preference-areas">${content}</ul>`;
}
function bindingLabel(item, linkedType = value => value) {
    const binding = item.binding;
    if (binding.declaringType) {
        const parameter = binding.argument
            ? ' · ' + typeName('$' + binding.argument + (binding.items || []).map(key => `[${JSON.stringify(key)}]`).join(''))
            : '';
        const shared = item.family === 'lifecycles' ? ` · ${binding.shared ? 'Shared instance' : 'New instance'}` : '';
        return linkedType(typeName(binding.declaringType)) + parameter + shared;
    }
    return linkedType(typeName(binding.requested)) + (binding.replacement ? ' → ' + typeName(binding.replacement) : '');
}
function coverageLabel({covered, total}) {
    return total ? `${covered}/${total} (${formatPercent(covered / total * 100)})` : 'N/A';
}
function directoryRow(label, {covered, total, unmeasured}, href) {
    const percent = total ? covered / total * 100 : 0;
    const level = percent >= 90 ? 'high' : percent >= 50 ? 'medium' : 'low';
    const bar = total ? `<span class="bar" aria-hidden="true"><span style="width:${percent.toFixed(2)}%"></span></span>` : '';
    const name = href ? `<a href="${escape(href)}">${escape(label)}</a>` : escape(label);
    return `<tr${href ? '' : ' class="total"'}><th scope="row">${name}</th><td class="metric ${total ? level : 'neutral'}">${bar}${coverageLabel({covered, total})}</td><td>${total - covered}</td><td>${unmeasured}</td></tr>`;
}
function reportDetails(result) {
    const metrics = [
        ['Layout declarations', result.layout],
        ['Observer registrations by area', result.observers],
        ['Plugin registrations by area', result.plugins],
        ['Preferences by area', result.preferences],
        ...Object.values(diFamilies).map(({key, title}) => [`${title} by area`, result[key]]),
    ].filter(([, metric]) => metric?.total);
    const rows = metrics.map(([label, metric]) => `<tr><th scope="row">${label}</th><td>${coverageLabel(metric)}</td></tr>`).join('');
    const breakdown = rows ? `<details><summary>Coverage by declaration type</summary>
<table><thead><tr><th scope="col">Type</th><th scope="col">Covered</th></tr></thead><tbody>${rows}</tbody></table></details>` : '';
    return `${breakdown}<p><a href="coverage.json">Coverage data (JSON)</a></p>`;
}
function sourceTable(file, source) {
    const partial = new Set();
    for (const item of file.declarations.filter(item => item.state === 'uncovered')) {
        for (let line = item.startLine; line <= (item.highlightEndLine ?? item.endLine); line++) {
            if (file.lines[line].state === 'covered') partial.add(line);
        }
    }
    const rows = source.toString().split(/\r?\n/).map((text, index) => {
        const line = index + 1;
        const evidence = file.lines[line];
        const state = partial.has(line) ? 'partial' : evidence?.state || 'neutral';
        const hits = state === 'neutral' || state === 'unmeasured' ? '' : evidence.hits;
        return `<tr id="L${line}" class="line ${state}" data-state="${state}"><td class="number"><a href="#L${line}">${line}</a></td><td class="hits">${hits}</td><td class="code">${escape(text)}</td></tr>`;
    }).join('\n');
    return `<div class="scroll"><table class="source"><thead><tr><th scope="col">Line</th><th scope="col">Hits</th><th scope="col">Original source</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function writeReport(result, sources, directory = 'coverage/xml') {
    fs.mkdirSync(directory, {recursive: true});
    fs.copyFileSync(path.join(__dirname, 'xml-report', stylesheet), path.join(directory, stylesheet));
    const directories = new Map();
    function getDirectory(name) {
        if (!directories.has(name)) directories.set(name, {entries: new Map(), covered: 0, total: 0, unmeasured: 0});
        return directories.get(name);
    }
    getDirectory('');
    const files = new Set(result.files.map(file => file.path));
    for (const file of result.files) {
        const target = path.join(directory, file.path + '.html');
        fs.mkdirSync(path.dirname(target), {recursive: true});
        const prefix = '../'.repeat(file.path.split('/').length - 1);
        const details = file.declarations.filter(item => item.family !== 'layout' ||
            item.supported || !['file-selection', 'schema-hint', 'instruction'].includes(item.layout.kind)).map(item => {
            if (item.effects) {
                const effects = familyOutcomes(item).map(({type, state, outcomes}) =>
                    `<small>${escape(type)} · ${escape(state)}${outcomes.map(({area, outcome, reason}) =>
                        ` · ${escape(area)} · ${escape(outcome)}${reason ? ' · ' + escape(reason) : ''}`).join('')}</small>`).join('');
                return `<tr><td><a href="#L${item.startLine}">${escape(item.path)}</a><small>Original ${lineLabel(item)}</small></td>
                    <td>${escape(item.state)}${item.outcome ? ' · ' + escape(item.outcome) : ''}${item.reason ? '<small>' + escape(item.reason) + '</small>' : ''}${effects}</td></tr>`;
            }
            if (item.family === 'preferences' || Object.hasOwn(diFamilies, item.family)) {
                return `<tr><td>${bindingLabel(item, label => `<a href="#L${item.startLine}">${label}</a>`)}
                    <small>Original ${lineLabel(item)}</small></td><td>${preferenceAreas(item, files, prefix)}</td></tr>`;
            }
            if (item.family === 'layout') {
                const outcomes = item.evidence.map(event =>
                    `<small>${escape(event.type.replace(/^layout-/, '').replaceAll('-', ' '))}${layoutObservations.has(event.type) ? ' · observed fact' : ''} · ${escape(event.theme)}</small>`).join('');
                return `<tr><td><a href="#L${item.startLine}">${escape(item.path)}</a><small>${lineLabel(item)}</small></td><td>${escape(item.state)}${outcomes}${item.reason ? '<small>' + escape(item.reason) + '</small>' : ''}</td></tr>`;
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
        const unmeasured = Object.values(file.lines).filter(line => line.state === 'unmeasured').length;
        const measurement = file.reason ? `<p>${escape(file.reason)}</p>` : '';
        const diagnostics = details ? `<details><summary>Declaration details</summary><div class="scroll"><table>
<thead><tr><th scope="col">Declaration</th><th scope="col">Outcome</th></tr></thead><tbody>${details}</tbody></table></div></details>` : '';
        fs.writeFileSync(target, page(file.path, `<p><strong>Line coverage</strong> ${coverageLabel(file)} · ${file.total - file.covered} uncovered · ${unmeasured} unmeasured</p>
${measurement}${sourceTable(file, sources[file.path])}
<p class="legend"><span class="covered">Covered</span> <span class="uncovered">Uncovered</span> <span class="partial">Some declarations missed</span> <span class="unmeasured">Unmeasured</span></p>
${diagnostics}`, true));
        const parts = file.path.split('/');
        const filename = parts.pop();
        getDirectory(parts.join('/')).entries.set(encodeURIComponent(filename) + '.html', {
            label: filename, counts: {covered: file.covered, total: file.total, unmeasured}
        });
        for (;;) {
            const current = getDirectory(parts.join('/'));
            current.covered += file.covered;
            current.total += file.total;
            current.unmeasured += unmeasured;
            if (!parts.length) break;
            const child = parts.pop();
            getDirectory(parts.join('/')).entries.set(encodeURIComponent(child) + '/index.html', {label: child + '/', counts: current});
        }
    }
    for (const [name, counts] of directories) {
        const rows = [...counts.entries].sort(([, a], [, b]) => a.label.localeCompare(b.label))
            .map(([href, entry]) => directoryRow(entry.label, entry.counts, href)).join('');
        fs.mkdirSync(path.join(directory, name), {recursive: true});
        fs.writeFileSync(path.join(directory, name, 'index.html'), page(name, `
<div class="scroll"><table><thead><tr><th scope="col">Directory / file</th><th scope="col">Line coverage</th><th scope="col">Uncovered</th><th scope="col">Unmeasured</th></tr></thead>
<tbody>${directoryRow('Total', counts)}${rows}</tbody></table></div>
<p class="muted">A line counts as covered when at least one declaration on it was observed. Unmeasured lines are outside the percentage. N/A means the file or directory has no measured lines.</p>
${name ? '' : reportDetails(result)}`));
    }
    fs.writeFileSync(path.join(directory, 'coverage.json'), JSON.stringify(result, null, 2));
}
function report() {
    const read = file => JSON.parse(fs.readFileSync(file));
    assert.equal(fs.existsSync('coverage/.active-run'), false, 'Stop and drain collection before XML reporting');
    const run = read('coverage/run.json'), manifest = read('coverage/xml-manifest.json');
    assert.equal(run.id, manifest.run);
    const raw = `coverage/raw/php/${run.id}`;
    assert.ok(!fs.readdirSync(raw).some(file => file.endsWith('.error')), 'Failed PHP collection');
    const metadata = fs.readdirSync(raw).filter(file => XML_REQUEST_METADATA.test(file));
    const records = metadata.map(file => {
        const request = read(`${raw}/${file}`);
        assert.ok(request.xml, 'Missing XML runtime evidence');
        if (request.commandId) {
            assert.equal(request.commandId, file.split('.')[0], 'Mismatched CLI XML record');
            assert.ok(['magento', 'magerun'].includes(request.tool), 'Invalid CLI XML tool');
        }
        return {...request.xml, uri: request.uri, method: request.method, status: request.status, tool: request.commandId ? request.tool : undefined, request: request.commandId ?? file.slice(0, -5)};
    });
    const sources = readSources(manifest.files);
    const result = merge(manifest, records, sources, readXmlBrowserEvidence(run.id));
    writeReport(result, sources);
    return result;
}
module.exports = {merge, writeReport, report, layoutEvents, countsAsLayoutCoverage};
if (require.main === module) report();
