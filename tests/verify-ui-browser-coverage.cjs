// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {listingEffects, formEffects, fields, columns, provider, responseId} =
    require('./fixtures/ui-module/module/Test/Browser/journey.cjs');

const result = JSON.parse(fs.readFileSync('coverage/xml/coverage.json'));
assert.equal(result.complete, true);
assert.equal(result.sourcesUnchanged, true);
assert.deepEqual(result.collectorErrors, []);

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

for (const {identity, type} of listingEffects) evidence(identity, type, identity === columns + 'equal');
for (const {identity, type} of formEffects) evidence(identity, type);

const neverInstantiated = declaration(fields + 'uninstantiated');
assert.equal(neverInstantiated.effectStates['ui-delivered'], 'covered');
for (const effect of ['ui-constructed', 'ui-rendered', 'ui-action-invoked']) {
    assert.equal(neverInstantiated.effectStates[effect], 'uncovered');
}
assert.equal(declaration(fields + 'uninvoked').effectStates['ui-action-invoked'], 'uncovered');
assert.equal(declaration(columns + 'disabled').effectStates['ui-delivered'], 'uncovered');

const document = new Set(evidence(columns + 'untouched', 'ui-rendered').map(event => event.request));
for (const reload of evidence(provider, 'ui-reloaded')) assert.ok(!document.has(reload.request));
assert.doesNotMatch(JSON.stringify(declarations), /Browser fixture edit|Fixture value|First row|Second row/);
console.log('PASS: distinct browser delivery, construction, rendering, action and AJAX reload outcomes.');
