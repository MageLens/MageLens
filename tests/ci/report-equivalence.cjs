// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {layoutEvents, countsAsLayoutCoverage} = require('../../bin/report-xml.cjs');
const digest = value => createHash('sha256').update(value.replace(/\r\n?/g, '\n')).digest('hex');
const sort = values => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
const read = (directory, file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
const object = value => { assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Missing coverage map'); return value; };
const array = value => { assert.ok(Array.isArray(value), 'Missing coverage inventory'); return value; };
const count = value => { assert.ok(Number.isSafeInteger(value) && value >= 0, 'Invalid coverage count'); return value; };
const hit = value => count(value) > 0;
// Istanbul uses empty positions for an implicit else path with no source span.
const position = value => { object(value); return [value.line === undefined ? null : count(value.line), value.column === undefined ? null : count(value.column)]; };
const location = value => [position(value?.start), position(value?.end)];
// Hash arbitrary strings, including private package names, expressions and warnings.
// Only repository/public fixture paths are retained for useful CI diagnostics.
function fileKey(file) {
    const match = String(file).replace(/\\/g, '/').match(/(?:^|\/)((?:app\/code|app\/design|vendor|lib\/web)\/[^\0]+)$/);
    assert.ok(match && !match[1].split('/').includes('..'), 'Unrecognized coverage source root');
    const relative = match[1];
    return /^(?:app\/code\/(?:Application\/Blog|MageLens\/Compatibility)\/|vendor\/hyva-themes\/magento2-default-theme-csp\/)/.test(relative)
        ? relative : `source-sha256:${digest(relative)}`;
}
function files(entries, project) {
    const result = {};
    for (const [file, value] of entries) {
        const key = fileKey(file);
        assert.ok(!(key in result), 'Duplicate normalized coverage source');
        result[key] = project(value);
    }
    return result;
}
function counters(counts, maps, project) {
    assert.deepEqual(Object.keys(object(counts)).sort(), Object.keys(object(maps)).sort(), 'Incomplete counter map');
    return sort(Object.entries(counts).map(([id, value]) => project(maps[id], value)));
}
function totals(value) {
    object(value);
    return Object.fromEntries(Object.entries(value).map(([key, number]) => {
        assert.ok(['total', 'covered', 'uncovered', 'skipped', 'pct', 'percent', 'eligible', 'unsupported'].includes(key), 'Unknown coverage total');
        // Istanbul's empty library group has no denominator and uses this literal.
        // Preserve it; it is valid only for an explicitly empty coverage group.
        assert.ok(number === null || Number.isFinite(number) ||
            key === 'pct' && number === 'Unknown' && value.total === 0 && value.covered === 0, 'Invalid coverage total');
        return [key, number];
    }));
}
const istanbulTotals = value => Object.fromEntries(['lines', 'statements', 'functions', 'branches', ...('branchesTrue' in object(value) ? ['branchesTrue'] : [])]
    .map(key => [key, totals(value[key])]));
function templateCounter(value) {
    return [location(value), digest(value.syntax || value.type || ''), Boolean(value.implicit), hit(value.hits), digest(value.name || value.binding || '')];
}
function template(value) {
    assert.equal(typeof value.source, 'string', 'Missing template source fingerprint');
    assert.equal(typeof value.instrumented, 'boolean');
    assert.ok(['observed', 'unobserved', 'unsupported'].includes(value.status));
    return {
        source: digest(value.source), kind: digest(value.kind), engine: digest(value.engine),
        engines: sort(array(value.engines).map(digest)), instrumented: value.instrumented, status: value.status,
        warnings: sort(array(value.unsupportedDirectives || []).map(digest)), executionUnsupported: digest(value.executionUnsupported || ''),
        statements: sort(array(value.statements).map(templateCounter)),
        functions: sort(array(value.functions).map(templateCounter)),
        branches: sort(array(value.branches).map(templateCounter)),
        lines: Object.fromEntries(Object.entries(object(value.lineHits)).map(([line, data]) =>
            [line, [hit(data.hits), count(data.statements), count(data.covered)]])),
        totals: Object.fromEntries(['lineSummary', 'statementSummary', 'functionSummary', 'branchSummary'].map(key => [key, totals(value[key])])),
        scripts: sort(array(value.scripts).map(script => ({line: count(script.line), status: digest(script.status), reason: digest(script.reason || ''),
            generated: sort((script.generated || []).map(fragment => ({line: count(fragment.line), tracked: Boolean(fragment.tracked),
                status: digest(fragment.status), reason: digest(fragment.reason || ''), emptyObserved: Boolean(fragment.emptyObserved),
                targets: sort(array(fragment.targets).map(target => fileKey(target.path)))})))})))
    };
}
function pluginIdentity({subject, method, phase}) {
    return [digest(subject), digest(method), phase];
}
function preferenceOrigin(origin) {
    if (!origin) return null;
    const file = origin.path.replace(/\\/g, '/');
    const source = /(?:^|\/)app\/etc\/di\.xml$/.test(file) ? 'app/etc/di.xml' : fileKey(file);
    return [origin.id, source, origin.startLine, origin.endLine, origin.fingerprint];
}
function diAreas(areas) {
    return sort(Object.entries(object(areas)).map(([area, outcome]) =>
        [area, outcome.status, outcome.state, hit(outcome.hits), digest(outcome.reason || ''),
            preferenceOrigin(outcome.origin), outcome.effectiveReplacement == null ? null : digest(outcome.effectiveReplacement),
            outcome.resolved == null ? null : digest(outcome.resolved)]));
}
function snapshot(directory) {
    const run = read(directory, 'run.json');
    const php = read(directory, 'php/coverage-summary.json');
    const js = read(directory, 'javascript-summary.json');
    const scope = read(directory, 'javascript-scope.json');
    const templates = read(directory, 'templates/coverage-summary.json');
    const summary = read(directory, 'summary.json');
    const xml = read(directory, 'xml/coverage.json');
    assert.equal(xml.run, run.id, 'Stale XML coverage');
    assert.equal(xml.complete, true);
    assert.equal(xml.sourcesUnchanged, true);
    assert.deepEqual(xml.collectorErrors, []);
    for (const report of [php, js, scope, summary]) assert.equal(report.run, run.id, 'Stale coverage summary');
    assert.equal(templates.schemaVersion, 2);
    const groups = files(array(scope.included).map(entry => [entry.path, entry]), entry => {
        assert.ok(['application', 'libraries'].includes(entry.group), 'Missing JavaScript report group');
        return entry.group;
    });
    const javascript = read(directory, 'js/coverage-final.json');
    assert.deepEqual(Object.keys(groups).sort(), Object.keys(files(Object.entries(javascript), () => true)).sort(), 'Incomplete JavaScript source inventory');
    assert.ok(xml.layout || !array(xml.files).some(file => file.declarations.some(item => item.family === 'layout')),
        'Missing layout coverage summary');
    const result = {
        schema: 1, run: run.id,
        metrics: Object.fromEntries(['php', 'js', 'templates', 'xml'].map(key => [key, summary.metrics[key].percent])),
        xml: {totals: totals({total: xml.total, covered: xml.covered, percent: xml.percent}),
            observers: {total: count(xml.observers?.total), covered: count(xml.observers?.covered)},
            plugins: {total: count(xml.plugins?.total ?? 0), covered: count(xml.plugins?.covered ?? 0)},
            preferences: {total: count(xml.preferences?.total ?? 0), covered: count(xml.preferences?.covered ?? 0)},
            virtualTypes: {total: count(xml.virtualTypes?.total ?? 0), covered: count(xml.virtualTypes?.covered ?? 0)},
            arguments: {total: count(xml.arguments?.total ?? 0), covered: count(xml.arguments?.covered ?? 0)},
            lifecycles: {total: count(xml.lifecycles?.total ?? 0), covered: count(xml.lifecycles?.covered ?? 0)},
            layout: {total: count(xml.layout?.total ?? 0), covered: count(xml.layout?.covered ?? 0),
                limitations: sort(array(xml.layout?.limitations ?? []).map(digest))},
            warnings: sort(array(xml.warnings).map(item => [fileKey(item.path), item.declaration || null, item.area || null, digest(item.reason)])),
            files: files(array(xml.files).map(file => [file.path, file]), file => ({
                source: file.sourceFingerprint, reason: digest(file.reason || ''),
                ...(file.layoutProvider?.type === 'theme' && file.layoutProvider.area === 'frontend' ? {storefrontLayout: true} : {}),
                lines: Object.fromEntries(Object.entries(object(file.lines)).map(([line, value]) => [line, value.state])),
                declarations: sort(array(file.declarations).map(item => ({
                    id: item.id, path: digest(item.path), scope: [item.declaredScope.type, digest(item.declaredScope.code)],
                    range: [item.startLine, item.endLine], supported: item.supported, effective: item.effective,
                    state: item.state, reason: digest(item.reason || ''),
                    ...(item.family === 'layout' ? {
                        layout: [item.layout.kind, item.layout.fileType, item.layout.ordinal, digest(item.layout.element),
                            digest(item.layout.handle), digest(item.layout.instruction), digest(item.layout.attribute || ''),
                            digest(item.layout.selection || ''), digest(item.layout.destination || '')]
                    } : {}),
                    ...(item.family === 'events' ? {
                        registration: [digest(item.registration.event), digest(item.registration.observer)],
                        areas: sort(Object.entries(object(item.areas)).map(([area, outcome]) =>
                            [area, outcome.status, outcome.state, hit(outcome.hits), digest(outcome.reason || '')]))
                    } : {}),
                    ...(item.family === 'plugins' ? {
                        plugin: [digest(item.registration.target), digest(item.registration.name)],
                        pluginAreas: sort(Object.entries(object(item.areas)).map(([area, outcome]) =>
                            [area, outcome.status, outcome.state, hit(outcome.hits), digest(outcome.reason || ''),
                                sort(Object.values(outcome.callbacks).map(callback =>
                                    [...pluginIdentity(callback), callback.state, hit(callback.hits), Boolean(callback.ambiguousEntry)]))]))
                    } : {}),
                    ...(item.family === 'preferences' ? {
                        preference: [digest(item.binding.requested), digest(item.binding.replacement)],
                        preferenceAreas: diAreas(item.areas)
                    } : {}),
                    ...(item.family === 'virtual-types' ? {
                        virtualType: [digest(item.binding.requested), digest(item.binding.replacement)],
                        virtualTypeAreas: diAreas(item.areas)
                    } : {}),
                    ...(item.family === 'arguments' ? {
                        argument: [digest(item.binding.declaringType), digest(item.binding.argument), ...(item.binding.items || []).map(digest)],
                        argumentAreas: diAreas(item.areas)
                    } : {}),
                    ...(item.family === 'lifecycles' ? {
                        lifecycle: [digest(item.binding.declaringType), digest(String(item.binding.shared)),
                            ...(item.binding.argument ? [digest(item.binding.argument), ...(item.binding.items || []).map(digest)] : [])],
                        lifecycleAreas: diAreas(item.areas)
                    } : {}),
                    evidence: sort([...new Set(item.evidence.map(event => JSON.stringify(item.family === 'layout'
                        ? [event.type, event.area, digest(event.theme)]
                        : event.type === 'observer-execute'
                        ? [event.type, event.area, digest(event.registration.event), digest(event.registration.observer)]
                        : event.type === 'plugin-execute'
                            ? [event.type, event.area, digest(event.registration.target), digest(event.registration.name), ...pluginIdentity(event.callback)]
                            : ['preference-resolved', 'virtual-type-resolved'].includes(event.type)
                                ? [event.type, event.area, digest(event.requested), digest(event.binding.requested), digest(event.binding.replacement), digest(event.resolved)]
                                : ['argument-applied', 'lifetime-applied'].includes(event.type)
                                    ? [event.type, event.area, digest(event.requested), digest(event.binding.declaringType),
                                        digest(event.binding.argument || ''), digest(String(event.binding.shared)),
                                        ...(event.binding.items || []).map(digest)]
                                    : [event.type, event.requestedScope.type, digest(event.requestedScope.code)])))].map(value => JSON.parse(value)))
                })))
            }))},
        php: {totals: totals({total: php.total, covered: php.covered, percent: php.percent}),
            files: files(Object.entries(read(directory, 'php/line-coverage.json')), lines =>
                Object.fromEntries(Object.entries(object(lines)).map(([line, value]) => [line, hit(value)])))},
        js: {groups: Object.fromEntries(['all', 'application', 'libraries'].map(group => [group, istanbulTotals(js.groups[group])])),
            inventory: groups, requiredExecuted: sort(array(scope.requiredExecuted).map(fileKey)),
            excluded: sort(array(js.excluded).map(entry => [fileKey(entry.path), digest(entry.reason), entry.replacement ? fileKey(entry.replacement) : null])),
            files: files(Object.entries(javascript), value => ({
                statements: counters(value.s, value.statementMap, (loc, hits) => [location(loc), hit(hits)]),
                functions: counters(value.f, value.fnMap, (fn, hits) => [location(fn.loc), location(fn.decl), hit(hits), digest(fn.name)]),
                branches: counters(value.b, value.branchMap, (branch, hits) => {
                    assert.equal(array(hits).length, array(branch.locations).length, 'Incomplete branch paths');
                    return [digest(branch.type), location(branch.loc), hits.map((hits, index) => [location(branch.locations[index]), hit(hits)])];
                })
            }))},
        templates: {totals: Object.fromEntries(['summary', 'lines', 'statements', 'functions', 'branches'].map(key => [key, totals(templates[key])])),
            files: files(array(templates.templates).map(entry => [entry.path, entry]), template)}
    };
    validateSnapshot(result, run.id, summary);
    return result;
}
function validateSnapshot(value, run, summary) {
    assert.equal(value.schema, 1, 'Missing complete coverage snapshot');
    assert.equal(value.run, run, 'Stale complete coverage snapshot');
    for (const type of ['php', 'js', 'templates', 'xml']) {
        assert.ok(Object.keys(object(value[type]?.files)).length, `Empty ${type} inventory`);
        assert.equal(value.metrics[type], summary.metrics[type].percent, `Mismatched ${type} summary`);
    }
    totals(value.xml.totals);
    array(value.xml.warnings);
    const observerTotals = {total: 0, covered: 0};
    const pluginTotals = {total: 0, covered: 0};
    const preferenceTotals = {total: 0, covered: 0};
    const virtualTotals = {total: 0, covered: 0};
    const argumentTotals = {total: 0, covered: 0};
    const lifecycleTotals = {total: 0, covered: 0};
    const layoutTotals = {total: 0, covered: 0};
    let hasLayout = false;
    for (const file of Object.values(value.xml.files)) {
        assert.match(file.source, /^[a-f0-9]{64}$/);
        object(file.lines);
        for (const item of array(file.declarations)) {
            if (item.layout) {
                hasLayout = true;
                const [kind, fileType, ordinal, ...identity] = array(item.layout);
                assert.ok(Object.hasOwn(layoutEvents, kind) || ['instruction', 'attribute', 'schema-hint'].includes(kind));
                if (kind === 'schema-hint') {
                    assert.equal(item.state, 'unmeasured', 'Schema hints cannot receive runtime coverage');
                    assert.deepEqual(item.evidence, [], 'Schema hints cannot receive runtime evidence');
                }
                assert.ok(['page', 'generic', 'wireframe', 'custom', 'registry', 'page-types'].includes(fileType));
                count(ordinal);
                assert.equal(identity.length, 6);
                for (const part of identity) assert.match(part, /^[a-f0-9]{64}$/);
                for (const [effect, area, theme] of array(item.evidence)) {
                    assert.ok(Object.hasOwn(layoutEvents, kind) && layoutEvents[kind].includes(effect), 'Unexpected layout effect');
                    assert.ok(['frontend', 'adminhtml'].includes(area));
                    assert.match(theme, /^[a-f0-9]{64}$/);
                }
                const observedEffect = item.evidence.some(([effect]) => countsAsLayoutCoverage(effect));
                assert.equal(item.state === 'covered', item.supported && observedEffect,
                    'Layout coverage requires an eligible native effect; creation and selection facts cannot substitute for rendering');
                if (item.state !== 'unmeasured') layoutTotals.total++;
                if (item.state === 'covered') layoutTotals.covered++;
            }
            if (item.plugin) {
                assert.equal(array(item.plugin).length, 2);
                for (const part of item.plugin) assert.match(part, /^[a-f0-9]{64}$/);
                for (const [area, status, state, executed, reason, callbacks] of array(item.pluginAreas)) {
                    assert.equal(typeof area, 'string');
                    assert.ok(['eligible', 'disabled', 'overridden', 'ambiguous', 'unsupported'].includes(status));
                    assert.equal(typeof executed, 'boolean');
                    assert.match(reason, /^[a-f0-9]{64}$/);
                    assert.equal(array(callbacks).length > 0, status === 'eligible');
                    assert.equal(executed, callbacks.some(callback => callback[4]));
                    assert.equal(state, status === 'eligible' ? (executed ? 'covered' : 'uncovered') : 'unmeasured');
                    for (const [subject, method, phase, callbackState, covered, uncertain] of callbacks) {
                        for (const part of [subject, method]) assert.match(part, /^[a-f0-9]{64}$/);
                        assert.ok(['before', 'around', 'after'].includes(phase));
                        assert.equal(typeof covered, 'boolean');
                        assert.equal(typeof uncertain, 'boolean');
                        assert.equal(callbackState, covered ? 'covered' : 'uncovered');
                    }
                    if (status === 'eligible') pluginTotals.total++;
                    if (executed) pluginTotals.covered++;
                }
            }
            for (const [kind, total] of [['preference', preferenceTotals], ['virtualType', virtualTotals], ['argument', argumentTotals],
                ['lifecycle', lifecycleTotals]]) {
                if (!item[kind]) continue;
                assert.ok(['argument', 'lifecycle'].includes(kind) ? array(item[kind]).length >= 2 : array(item[kind]).length === 2);
                for (const part of item[kind]) assert.match(part, /^[a-f0-9]{64}$/);
                const areas = array(item[kind + 'Areas']);
                assert.equal(new Set(areas.map(outcome => outcome[0])).size, areas.length);
                for (const area of ['global', 'frontend', 'adminhtml']) assert.ok(areas.some(outcome => outcome[0] === area));
                for (const [area, status, state, resolved, reason, origin, replacement, type] of areas) {
                    assert.equal(typeof area, 'string');
                    assert.ok(['eligible', 'inactive', 'overridden', 'ambiguous', 'unsupported'].includes(status));
                    assert.equal(typeof resolved, 'boolean');
                    assert.match(reason, /^[a-f0-9]{64}$/);
                    for (const part of [replacement, type]) if (part !== null) assert.match(part, /^[a-f0-9]{64}$/);
                    if (origin) {
                        const [id, source, start, end, fingerprint] = array(origin);
                        assert.match(id, /^[a-f0-9]{64}$/);
                        assert.equal(typeof source, 'string');
                        assert.ok(count(start) > 0 && count(end) >= start);
                        assert.match(fingerprint, /^[a-f0-9]{64}$/);
                    }
                    assert.equal(state, status === 'eligible' ? (resolved ? 'covered' : 'uncovered') : 'unmeasured');
                    if (status === 'eligible') {
                        assert.equal(origin?.[0], item.id);
                        if (kind === 'preference' || kind === 'virtualType') {
                            assert.equal(replacement, item[kind][1]);
                            assert.ok(type);
                        }
                        total.total++;
                        if (resolved) total.covered++;
                    } else {
                        assert.equal(resolved, false);
                    }
                }
            }
            if (!item.registration) continue;
            assert.equal(array(item.registration).length, 2);
            for (const part of item.registration) assert.match(part, /^[a-f0-9]{64}$/);
            for (const [area, status, state, executed, reason] of array(item.areas)) {
                assert.equal(typeof area, 'string');
                assert.ok(['eligible', 'disabled', 'overridden', 'ambiguous', 'unsupported'].includes(status));
                assert.equal(typeof executed, 'boolean');
                assert.match(reason, /^[a-f0-9]{64}$/);
                assert.equal(state, status === 'eligible' ? (executed ? 'covered' : 'uncovered') : 'unmeasured');
                if (status === 'eligible') observerTotals.total++;
                if (executed) {
                    assert.equal(status, 'eligible');
                    observerTotals.covered++;
                }
            }
        }
        for (const state of Object.values(file.lines)) assert.ok(['covered', 'uncovered', 'unmeasured'].includes(state));
    }
    assert.deepEqual(value.xml.observers, observerTotals, 'Incomplete observer coverage inventory');
    assert.deepEqual(value.xml.plugins, pluginTotals, 'Incomplete plugin coverage inventory');
    assert.deepEqual(value.xml.preferences ?? {total: 0, covered: 0}, preferenceTotals, 'Incomplete preference coverage inventory');
    assert.deepEqual(value.xml.virtualTypes ?? {total: 0, covered: 0}, virtualTotals, 'Incomplete virtual type coverage inventory');
    assert.deepEqual(value.xml.arguments ?? {total: 0, covered: 0}, argumentTotals, 'Incomplete constructor argument coverage inventory');
    assert.deepEqual(value.xml.lifecycles ?? {total: 0, covered: 0}, lifecycleTotals, 'Incomplete object lifetime coverage inventory');
    assert.ok(value.xml.layout || !hasLayout, 'Missing layout coverage summary');
    const {limitations: layoutLimitations, ...layoutSummary} = value.xml.layout ?? {...layoutTotals, limitations: []};
    assert.deepEqual(layoutSummary, layoutTotals, 'Incomplete layout coverage inventory');
    for (const reason of array(layoutLimitations)) assert.match(reason, /^[a-f0-9]{64}$/);
    totals(value.php.totals);
    for (const lines of Object.values(value.php.files)) for (const [line, covered] of Object.entries(object(lines))) {
        assert.match(line, /^[1-9]\d*$/, 'Invalid PHP line');
        assert.equal(typeof covered, 'boolean');
    }
    for (const group of ['all', 'application', 'libraries']) istanbulTotals(value.js.groups[group]);
    array(value.js.excluded);
    array(value.js.requiredExecuted);
    assert.deepEqual(Object.keys(object(value.js.inventory)).sort(), Object.keys(value.js.files).sort(), 'Incomplete JavaScript report groups');
    for (const file of Object.values(value.js.files)) for (const key of ['statements', 'functions', 'branches']) array(file[key]);
    for (const key of ['summary', 'lines', 'statements', 'functions', 'branches']) totals(value.templates.totals[key]);
    for (const file of Object.values(value.templates.files)) {
        for (const key of ['source', 'kind', 'engine', 'executionUnsupported']) assert.match(file[key], /^[a-f0-9]{64}$/, 'Missing source or measurement fingerprint');
        for (const key of ['engines', 'warnings', 'statements', 'functions', 'branches', 'scripts']) array(file[key]);
        object(file.lines);
        assert.equal(typeof file.instrumented, 'boolean');
        assert.ok(['observed', 'unobserved', 'unsupported'].includes(file.status));
        for (const key of ['lineSummary', 'statementSummary', 'functionSummary', 'branchSummary']) totals(file.totals[key]);
    }
}
function comparableXml(xml, platform) {
    // Native Admin theme names are platform run metadata. Keep the actual
    // contexts in each artifact and normalize only the expected native name
    // for this platform. Every source, effect and other context stays intact.
    const native = {magento: 'adminhtml/Magento/backend', mageos: 'adminhtml/MageOS/m137-admin-theme'}[platform];
    if (!native) return xml;
    const expected = digest(native);
    const normalized = digest('adminhtml/platform-native');
    const result = structuredClone(xml);
    for (const file of Object.values(result.files)) {
        for (const item of file.declarations) {
            if (!item.layout) continue;
            for (const evidence of item.evidence) {
                if (evidence[1] === 'adminhtml' && evidence[2] === expected) evidence[2] = normalized;
            }
            sort(item.evidence);
        }
    }
    return result;
}
function sharedLayout(xml) {
    const result = {};
    for (const [path, file] of Object.entries(xml.files)) {
        if (file.storefrontLayout || path.startsWith('app/design/frontend/')
            || path.startsWith('vendor/hyva-themes/magento2-default-theme-csp/')) continue;
        const declarations = file.declarations.filter(item => item.layout)
            .map(({id, path, scope, range, supported, layout}) => ({id, path, scope, range, supported, layout}));
        if (declarations.length) result[path] = {source: file.source, declarations: sort(declarations)};
    }
    return result;
}

function compareThemes(reports, expected) {
    const errors = [];
    const expectedIds = expected.map(entry => entry.id).sort();
    if (!isDeepStrictEqual(reports.map(report => report.id).sort(), expectedIds)) errors.push('Missing, unexpected or duplicate matrix reports');
    const sharedLayoutDifferences = [];
    if (reports.length) {
        const baseline = sharedLayout(reports[0].snapshot.xml);
        for (const report of reports.slice(1)) {
            const actual = sharedLayout(report.snapshot.xml);
            for (const file of [...new Set([...Object.keys(baseline), ...Object.keys(actual)])].sort()) {
                if (!isDeepStrictEqual(baseline[file], actual[file])) {
                    sharedLayoutDifferences.push({case: report.id, file, ...details(baseline[file], actual[file])});
                }
            }
        }
    }
    if (sharedLayoutDifferences.length) errors.push(`Shared layout: ${sharedLayoutDifferences.length} source or declaration differences`);
    const themes = {};
    for (const theme of ['luma', 'hyva']) {
        const entries = reports.filter(report => report.theme === theme);
        const required = expected.filter(entry => entry.theme === theme);
        const differences = [];
        const baseline = entries[0];
        for (const report of entries.slice(1)) {
            for (const section of ['metrics', 'php', 'js', 'templates', 'xml']) {
                const left = section === 'xml' ? comparableXml(baseline.snapshot.xml, baseline.platform) : baseline.snapshot[section];
                const right = section === 'xml' ? comparableXml(report.snapshot.xml, report.platform) : report.snapshot[section];
                if (isDeepStrictEqual(left, right)) continue;
                if (section === 'metrics') differences.push({case: report.id, section});
                else {
                    if (!isDeepStrictEqual({...left, files: null}, {...right, files: null})) differences.push({case: report.id, section, totals: true});
                    for (const file of [...new Set([...Object.keys(left.files), ...Object.keys(right.files)])].sort()) {
                        if (!isDeepStrictEqual(left.files[file], right.files[file])) differences.push({case: report.id, section, file,
                            ...details(left.files[file], right.files[file])});
                    }
                }
            }
        }
        themes[theme] = {baseline: baseline?.id, expectedCases: required.length, completedCases: entries.length, differences};
        if (entries.length !== required.length || differences.length) errors.push(`${theme}: ${entries.length}/${required.length} reports, ${differences.length} coverage differences`);
    }
    return {passed: errors.length === 0, errors, themes, sharedLayoutDifferences};
}
function details(left, right) {
    let total = 0;
    const changes = [];
    function visit(a, b, at) {
        if (isDeepStrictEqual(a, b)) return;
        if (a && b && typeof a === 'object' && typeof b === 'object') {
            for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) visit(a[key], b[key], `${at}/${key}`);
        } else {
            total++;
            // Bound diagnostics, never the comparison. Missing sources are identified
            // without copying their entire counter maps into every mismatch report.
            if (changes.length < 100) changes.push({at, expected: typeof a === 'object' ? '<inventory>' : a ?? null,
                actual: typeof b === 'object' ? '<inventory>' : b ?? null});
        }
    }
    visit(left, right, '');
    return {totalDifferences: total, changes};
}
module.exports = {snapshot, validateSnapshot, compareThemes};
