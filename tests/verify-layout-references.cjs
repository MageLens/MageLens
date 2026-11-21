// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2] || 'coverage/xml/coverage.json'));
function expectReference(suffix, element, effects, state) {
    const source = report.files.find(file => file.path.endsWith(suffix));
    assert.ok(source, suffix);
    for (const [attribute, kind] of [[null, 'reference'], ['name', 'reference-name']]) {
        const item = source.declarations.find(item => item.layout.element === element
            && item.layout.instruction.startsWith('reference') && item.layout.attribute === attribute);
        assert.ok(item, element);
        assert.equal(item.layout.kind, kind, element);
        assert.equal(item.supported, true, element);
        assert.equal(item.state, state, element);
        assert.deepEqual([...new Set(item.evidence.map(event => event.type))].sort(), [...effects].sort(), element);
        assert.equal(item.hits > 0, state === 'covered', element);
    }
}
const base = '/Compatibility/view/frontend/layout/coverageprobe_references_base.xml';
const overlay = '/Compatibility/view/frontend/layout/coverageprobe_references_overlay.xml';
expectReference(base, 'magelens.reference.subject', ['layout-reference-target-observed', 'layout-reference-unchanged'], 'unmeasured');
expectReference(overlay, 'magelens.reference.subject', ['layout-reference-target-observed', 'layout-template-overridden',
    'layout-argument-applied', 'layout-argument-read', 'layout-action-executed'], 'covered');
expectReference('/LayoutOverlay/view/frontend/layout/coverageprobe_references_overlay.xml', 'magelens.reference.subject',
    ['layout-reference-target-observed', 'layout-template-selected', 'layout-template-executed'], 'covered');
expectReference(overlay, 'magelens.reference.inner', ['layout-reference-target-observed', 'layout-container-wrapper-rendered', 'layout-reference-child-attached'], 'covered');
expectReference(overlay, 'magelens.reference.absent.parent', ['layout-reference-target-missing'], 'unmeasured');
expectReference(overlay, 'magelens.reference.removed', ['layout-removal-applied'], 'covered');
expectReference(overlay, 'magelens.reference.removed.child', ['layout-reference-target-removed'], 'unmeasured');
expectReference(overlay, 'magelens.reference.hidden', ['layout-reference-target-observed', 'layout-display-denied'], 'covered');
expectReference(overlay, 'magelens.reference.missing', ['layout-reference-target-missing'], 'unmeasured');
expectReference(overlay, 'magelens.reference.unrendered', ['layout-reference-target-observed', 'layout-template-selected'], 'uncovered');
expectReference(overlay, 'magelens.reference.empty', ['layout-reference-target-observed'], 'uncovered');
expectReference('/Compatibility/view/frontend/layout/coverageprobe_references_never.xml', 'magelens.reference.subject', [], 'uncovered');
console.log('Verified original reference declarations/name operands, independent descendant effects and exact ineffective/unvisited outcomes.');
