// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {readXmlJson} = require('../bin/xml-report/json.cjs');
const {listingEffects, formEffects, fields, columns, provider, proofDirectory, responseId, initialDisabled} =
    require('./fixtures/ui-module/module/Test/Browser/journey.cjs');

const result = readXmlJson('coverage/xml/coverage.json', {omit: ['requests']});
assert.equal(result.complete, true);
assert.equal(result.sourcesUnchanged, true);
assert.deepEqual(result.collectorErrors, []);
const readProof = name => JSON.parse(fs.readFileSync(`${proofDirectory}/${name}.json`));
const grid = readProof('grid');
const form = readProof('form');
const responses = [grid.navigation, grid.initial, grid.asc, grid.desc, form.navigation, form.delivery];
for (const response of responses) assert.match(response, responseId);
assert.equal(new Set(responses).size, responses.length);

const declarations = result.files
    .filter(file => /\/(UiProbe|UiProbeOverlay)\/view\/adminhtml\/ui_component\//.test(file.path))
    .flatMap(file => file.declarations.map(item => ({...item, source: file.path})));
function declaration(identity, overlay = false) {
    const found = declarations.filter(item => item.path === identity &&
        item.source.includes(overlay ? '/UiProbeOverlay/' : '/UiProbe/'));
    assert.equal(found.length, 1, identity);
    return found[0];
}
function evidence(identity, type, overlay = false) {
    const item = declaration(identity, overlay);
    assert.equal(item.effectStates[type], 'covered', `${item.source} ${identity} ${type}`);
    const matching = item.evidence.filter(entry => entry.type === type && entry.origin === 'browser');
    assert.ok(matching.length, `${identity} ${type} requires browser evidence`);
    for (const event of matching) {
        assert.equal(event.area, 'adminhtml');
        assert.equal(event.run, result.run);
        assert.match(event.request, responseId);
        const anchor = type === 'ui-reloaded' ? 'ui-provider-executed' : 'ui-delivered';
        assert.ok(item.evidence.some(entry => entry.type === anchor && entry.request === event.request),
            `${identity} ${type} has matching native response evidence`);
    }
    return matching;
}

for (const {identity, type} of listingEffects) {
    assert.deepEqual(evidence(identity, type, identity === columns + 'equal').map(event => event.request), [grid.navigation]);
}
for (const {identity, type} of formEffects) {
    assert.deepEqual(evidence(identity, type).map(event => event.request), [form.delivery]);
}

for (const identity of [fields + 'uninstantiated', initialDisabled]) {
    const disabled = declaration(identity);
    assert.equal(disabled.effectStates['ui-delivered'], 'covered');
    for (const effect of ['ui-constructed', 'ui-rendered', 'ui-action-invoked']) {
        assert.equal(disabled.effectStates[effect], 'uncovered', `${identity} ${effect}`);
        assert.ok(!disabled.evidence.some(event => event.type === effect && event.outcome === 'observed'));
    }
}
assert.equal(declaration(fields + 'uninvoked').effectStates['ui-action-invoked'], 'uncovered');
assert.equal(declaration(columns + 'disabled').effectStates['ui-delivered'], 'uncovered');

const reloads = new Set(evidence(provider, 'ui-reloaded').map(event => event.request));
for (const request of [grid.initial, grid.asc, grid.desc]) assert.ok(reloads.has(request), `Missing grid response ${request}`);
assert.ok(!reloads.has(grid.navigation));
assert.doesNotMatch(JSON.stringify(declarations), /Browser fixture edit|Fixture value|Read-only fixture value|First row|Second row/);
console.log('PASS: automatic UI evidence includes the initial grid response and the inserted form delivery.');
