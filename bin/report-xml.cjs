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
const diFamilies = {
    'virtual-types': {key: 'virtualTypes', title: 'Virtual type usage', event: 'virtual-type-resolved', action: 'resolved'},
    arguments: {key: 'arguments', title: 'Constructor argument usage', event: 'argument-applied', action: 'applied'},
    lifecycles: {key: 'lifecycles', title: 'Object lifetime usage', event: 'lifetime-applied', action: 'applied'},
};
const layoutEvents = {
    'configured-argument': ['layout-configured-argument-evaluated', 'layout-configured-class-selected', 'layout-configured-argument-supplied', 'layout-configured-operand-origin-unconfirmed'],
    'configured-argument-name': ['layout-configured-class-selected', 'layout-configured-argument-supplied', 'layout-configured-operand-origin-unconfirmed'],
    'configured-item': ['layout-configured-item-evaluated', 'layout-configured-operand-origin-unconfirmed'],
    'configured-item-name': ['layout-configured-item-name-applied', 'layout-configured-operand-origin-unconfirmed'],
    'action-item': ['layout-action-item-evaluated', 'layout-action-item-origin-unconfirmed'],
    'action-item-name': ['layout-action-item-name-applied', 'layout-action-item-origin-unconfirmed'],
    parameter: ['layout-parameter-evaluated', 'layout-parameter-value-inherited', 'layout-parameter-origin-unconfirmed', 'layout-parameter-overridden', 'layout-argument-group-ignored'],
    'parameter-name': ['layout-parameter-name-applied', 'layout-parameter-origin-unconfirmed', 'layout-parameter-overridden', 'layout-argument-group-ignored'],
    'argument-group': ['layout-argument-group-selected', 'layout-argument-group-ignored', 'layout-argument-group-failed', 'layout-argument-group-origin-unconfirmed'],
    'argument-translate': ['layout-argument-modifier-evaluated', 'layout-argument-modifier-deferred', 'layout-argument-modifier-failed', 'layout-argument-modifier-origin-unconfirmed', 'layout-argument-modifier-ambiguous'],
    'argument-shared': ['layout-argument-modifier-evaluated', 'layout-argument-modifier-deferred', 'layout-argument-modifier-failed', 'layout-argument-modifier-origin-unconfirmed', 'layout-argument-modifier-ambiguous'],
    'argument-model': ['layout-argument-modifier-evaluated', 'layout-argument-modifier-deferred', 'layout-argument-modifier-failed', 'layout-argument-modifier-origin-unconfirmed', 'layout-argument-modifier-ambiguous'],
    'argument-helper': ['layout-argument-modifier-evaluated', 'layout-argument-modifier-deferred', 'layout-argument-modifier-failed', 'layout-argument-modifier-origin-unconfirmed', 'layout-argument-modifier-ambiguous'],
    'argument-path': ['layout-argument-modifier-evaluated', 'layout-argument-modifier-deferred', 'layout-argument-modifier-failed', 'layout-argument-modifier-origin-unconfirmed', 'layout-argument-modifier-ambiguous'],
    'argument-type': ['layout-argument-type-evaluated', 'layout-argument-type-deferred', 'layout-argument-type-failed', 'layout-argument-type-origin-unconfirmed', 'layout-argument-type-ambiguous'],
    'ui-group': ['layout-ui-group-applied'],
    'visibility': ['layout-condition-allowed', 'layout-condition-denied', 'layout-condition-unconfirmed', 'layout-condition-failed'],
    'visibility-name': ['layout-condition-name-applied', 'layout-condition-name-unused', 'layout-condition-unconfirmed'],
    'visibility-class': ['layout-condition-class-selected', 'layout-condition-unconfirmed'],
    'visibility-argument': ['layout-condition-argument-applied', 'layout-condition-argument-unconsumed', 'layout-condition-unconfirmed'],
    'visibility-argument-name': ['layout-condition-argument-applied', 'layout-condition-argument-unconsumed', 'layout-condition-unconfirmed'],
    'page-type': ['layout-page-type-applied'],
    'page-type-id': ['layout-page-type-applied', 'layout-page-type-read', 'layout-registry-overridden'],
    'page-type-label': ['layout-page-type-applied', 'layout-page-type-read', 'layout-registry-overridden'],
    'registry-entry': ['layout-registry-entry-consumed', 'layout-registry-entry-configured', 'layout-registry-snapshot-returned', 'layout-registry-cache-unconfirmed'],
    'registry-id': ['layout-registry-id-consumed', 'layout-registry-overridden', 'layout-registry-snapshot-returned', 'layout-registry-cache-unconfirmed'],
    'registry-label': ['layout-registry-label-consumed', 'layout-registry-overridden', 'layout-registry-label-ignored', 'layout-registry-label-unconfirmed', 'layout-registry-snapshot-returned', 'layout-registry-cache-unconfirmed'],
    'file-selection': ['layout-file-selected'],
    'include-handle': ['layout-include-traversed', 'layout-include-duplicate', 'layout-include-cycle', 'layout-include-missing'],
    'position-name': ['layout-position-name-applied', 'layout-position-name-defaulted', 'layout-position-replaced'],
    'position-as': ['layout-position-alias-applied', 'layout-position-replaced'],
    'position-before': ['layout-position-order-applied', 'layout-position-order-unchanged', 'layout-position-ignored', 'layout-position-replaced'],
    'position-after': ['layout-position-order-applied', 'layout-position-order-unchanged', 'layout-position-ignored', 'layout-position-replaced'],
    'file-override': ['layout-file-override-selected', 'layout-file-override-unconfirmed'],
    'asset-order': ['layout-asset-group-applied', 'layout-asset-overridden', 'layout-asset-replaced', 'layout-asset-removed-before-output'],
    'asset-condition': ['layout-asset-condition-rendered', 'layout-asset-overridden', 'layout-asset-replaced', 'layout-asset-removed-before-output'],
    'body-class': ['layout-body-class-rendered', 'layout-body-class-duplicate', 'layout-body-class-canceled', 'layout-body-classes-cleared', 'layout-body-class-replaced'],
    'body-class-name': ['layout-body-class-rendered', 'layout-body-class-duplicate', 'layout-body-class-canceled', 'layout-body-classes-cleared', 'layout-body-class-replaced'],
    'body-class-value': ['layout-body-class-rendered', 'layout-body-class-duplicate', 'layout-body-class-canceled', 'layout-body-classes-cleared', 'layout-body-class-replaced'],
    'asset-reference': ['layout-asset-reference-rendered', 'layout-asset-overridden', 'layout-asset-replaced', 'layout-asset-removed-before-output'],
    'asset-src': ['layout-asset-reference-rendered', 'layout-asset-overridden', 'layout-asset-replaced', 'layout-asset-removed-before-output'],
    'asset-src-type': ['layout-asset-reference-rendered', 'layout-asset-overridden', 'layout-asset-replaced', 'layout-asset-removed-before-output'],
    'condition-ifconfig': ['layout-condition-allowed', 'layout-condition-denied'],
    'condition-aclResource': ['layout-condition-allowed', 'layout-condition-denied'],
    'condition-acl': ['layout-condition-allowed', 'layout-condition-denied'],
    container: ['layout-container-created'],
    'ui-placement': ['layout-ui-created', 'layout-ui-rendered', 'layout-ui-denied'],
    'page-attribute': ['layout-page-attribute-rendered', 'layout-page-attribute-overridden', 'layout-page-attribute-replaced'],
    'page-attribute-name': ['layout-page-attribute-rendered', 'layout-page-attribute-overridden', 'layout-page-attribute-replaced'],
    'page-attribute-value': ['layout-page-attribute-rendered', 'layout-page-attribute-overridden', 'layout-page-attribute-replaced'],
    metadata: ['layout-metadata-rendered', 'layout-metadata-overridden', 'layout-metadata-replaced'],
    'metadata-name': ['layout-metadata-rendered', 'layout-metadata-overridden', 'layout-metadata-replaced'],
    'metadata-content': ['layout-metadata-rendered', 'layout-metadata-overridden', 'layout-metadata-replaced'],
    'container-label': ['layout-container-label-applied', 'layout-container-label-read', 'layout-container-attribute-overridden', 'layout-container-attribute-replaced'],
    'container-htmlTag': ['layout-container-wrapper-rendered', 'layout-container-attribute-overridden', 'layout-container-attribute-replaced'],
    'container-htmlId': ['layout-container-wrapper-rendered', 'layout-container-attribute-overridden', 'layout-container-attribute-replaced'],
    'container-htmlClass': ['layout-container-wrapper-rendered', 'layout-container-attribute-overridden', 'layout-container-attribute-replaced'],
    'container-display': ['layout-display-allowed', 'layout-display-denied', 'layout-container-attribute-overridden', 'layout-container-attribute-replaced'],
    'block-display': ['layout-display-allowed', 'layout-display-denied', 'layout-container-attribute-replaced'],
    'block-class': ['layout-block-class-applied', 'layout-block-attribute-overridden', 'layout-block-class-origin-unconfirmed', 'layout-block-class-storage-unconfirmed', 'layout-block-class-defaulted'],
    'block-group': ['layout-block-group-applied', 'layout-block-attribute-overridden'],
    'block-ttl': ['layout-block-ttl-applied', 'layout-block-attribute-overridden', 'layout-block-ttl-origin-unconfirmed'],
    cacheability: ['layout-cacheability-denied', 'layout-cacheability-target-missing'],
    block: ['layout-block-created', 'layout-block-rendered', 'layout-block-render-failed', 'layout-block-reading-failed', 'layout-block-generation-failed', 'layout-block-cache-unconfirmed', 'layout-block-render-origin-unconfirmed', 'layout-block-registration-origin-unconfirmed'],
    action: ['layout-action-executed', 'layout-action-ambiguous', 'layout-action-origin-unconfirmed', 'layout-action-evaluation-failed', 'layout-action-completion-failed'],
    'action-method': ['layout-action-executed', 'layout-action-ambiguous', 'layout-action-origin-unconfirmed', 'layout-action-evaluation-failed', 'layout-action-completion-failed'],
    'action-ifconfig': ['layout-action-condition-allowed', 'layout-action-condition-denied', 'layout-action-condition-ambiguous',
        'layout-action-condition-empty-ignored', 'layout-action-condition-unobserved', 'layout-action-condition-origin-unconfirmed', 'layout-action-condition-failed'],
    'action-argument': ['layout-action-argument-evaluated', 'layout-action-argument-evaluation-incomplete', 'layout-action-argument-applied', 'layout-action-argument-ambiguous', 'layout-argument-origin-unconfirmed'],
    'argument-name': ['layout-argument-name-applied', 'layout-argument-name-overridden', 'layout-argument-name-mixed-origin', 'layout-argument-name-origin-unconfirmed'],
    'action-argument-name': ['layout-action-argument-name-evaluated', 'layout-action-argument-name-evaluation-incomplete', 'layout-action-argument-name-applied', 'layout-action-argument-name-ambiguous', 'layout-action-argument-name-origin-unconfirmed'],
    'argument-updater': ['layout-updater-executed', 'layout-updater-ignored', 'layout-updater-failed', 'layout-updater-ambiguous'],
    argument: ['layout-argument-evaluated', 'layout-argument-applied', 'layout-argument-read', 'layout-argument-replaced',
        'layout-argument-mixed-origin', 'layout-argument-overridden', 'layout-argument-identity-unconfirmed', 'layout-argument-origin-unconfirmed', 'layout-argument-application-unconfirmed', 'layout-argument-storage-unconfirmed', 'layout-argument-field-access-unconfirmed'],
    'page-title': ['layout-title-rendered', 'layout-title-overridden', 'layout-title-replaced'],
    'asset-removal': ['layout-asset-removed', 'layout-asset-removal-target-missing'],
    'asset-removal-node': ['layout-asset-removed', 'layout-asset-removal-target-missing'],
    wireframe: ['layout-wireframe-selected'],
    removal: ['layout-removal-applied', 'layout-removal-canceled', 'layout-removal-restored'],
    move: ['layout-move-applied', 'layout-move-removed', 'layout-move-detached', 'layout-move-target-missing', 'layout-move-unchanged', 'layout-move-unresolved', 'layout-move-replaced', 'layout-move-overridden', 'layout-move-origin-unconfirmed'],
    'wireframe-selection': ['layout-wireframe-selected', 'layout-wireframe-origin-unconfirmed'],
    include: ['layout-include-traversed', 'layout-include-duplicate', 'layout-include-cycle', 'layout-include-missing'],
    template: ['layout-template-selected', 'layout-template-executed', 'layout-template-overridden', 'layout-template-replaced', 'layout-template-failed', 'layout-template-field-access-unconfirmed', 'layout-template-origin-unconfirmed', 'layout-template-cache-unconfirmed',
        'layout-template-resolver-storage-unconfirmed', 'layout-template-context-storage-unconfirmed', 'layout-template-engine-pool-storage-unconfirmed', 'layout-template-validation-rejected'],
};
for (const name of ['element', 'destination', 'as', 'before', 'after']) {
    const effects = name === 'as' ? ['alias-applied', 'alias-unchanged', 'destination-missing']
        : ['before', 'after'].includes(name) ? ['order-applied', 'order-unchanged', 'ignored', 'destination-missing']
        : ['applied', 'unchanged', ...(name === 'element' ? ['detached'] : ['destination-missing'])];
    layoutEvents['move-' + name] = [...effects, 'target-missing', 'unresolved', 'replaced', 'overridden', 'origin-unconfirmed']
        .map(effect => 'layout-move-' + effect);
}
for (const kind of ['label', 'type']) {
    layoutEvents['handle-' + kind] = ['layout-handle-' + kind + '-evaluated', 'layout-handle-metadata-returned',
        'layout-handle-metadata-overridden', 'layout-handle-metadata-origin-unconfirmed'];
}
for (const name of ['defer', 'async', 'charset', 'hreflang', 'media', 'rel', 'rev', 'sizes', 'target', 'type', 'integrity', 'crossorigin', 'as']) {
    layoutEvents['asset-attribute-' + name] = ['layout-asset-attribute-emitted', 'layout-asset-attributes-discarded',
        'layout-asset-overridden', 'layout-asset-replaced', 'layout-asset-removed-before-output'];
}
for (const [kind, type] of [
    ['template', 'layout-template-empty-ignored'], ['page-title', 'layout-title-empty-ignored'], ['block-group', 'layout-block-group-empty-ignored'],
    ['block-ttl', 'layout-block-ttl-empty-ignored'], ['block-display', 'layout-display-empty-ignored'],
    ['removal', 'layout-removal-empty-ignored'], ['container-htmlClass', 'layout-container-wrapper-zero-class-emitted'],
]) layoutEvents[kind].push(type);
for (const kind of ['page-attribute', 'page-attribute-name', 'page-attribute-value']) {
    layoutEvents[kind].push('layout-page-attribute-removed', 'layout-page-attribute-removed-before-output',
        'layout-page-attribute-removal-target-missing');
}
for (const kind of ['metadata', 'metadata-name', 'metadata-content']) {
    layoutEvents[kind].push('layout-metadata-empty-suppressed', 'layout-metadata-content-type-derived',
        'layout-metadata-content-type-input', 'layout-metadata-template-skipped', 'layout-metadata-origin-unconfirmed');
}
for (const kind of ['metadata', 'metadata-name']) layoutEvents[kind].push('layout-metadata-key-emitted');
layoutEvents['metadata-content'].push('layout-metadata-content-fallback');
for (const kind of ['argument', 'argument-name', 'argument-type', 'argument-updater',
    'argument-translate', 'argument-shared', 'argument-model', 'argument-helper', 'argument-path',
    'configured-argument', 'configured-argument-name', 'configured-item', 'configured-item-name',
    'visibility-argument', 'visibility-argument-name']) layoutEvents[kind].push('layout-argument-group-ignored');
for (const kind of ['argument', 'action-argument']) layoutEvents[kind].push(...layoutEvents.template.filter(type => type !== 'layout-template-empty-ignored'));
layoutEvents.argument.push('layout-template-constructor-origin-unconfirmed');
layoutEvents['action-argument'].push('layout-template-assignment-origin-unconfirmed');
const referenceEvents = [...new Set(['template', 'argument', 'action', 'container-htmlTag', 'container-label',
    'block-class', 'block-group', 'block-ttl', 'block-display', 'removal'].flatMap(kind => layoutEvents[kind]))]
    .filter(type => !['layout-argument-evaluated', 'layout-argument-mixed-origin', 'layout-argument-overridden',
        'layout-argument-identity-unconfirmed', 'layout-argument-origin-unconfirmed'].includes(type));
for (const kind of ['reference', 'reference-name']) layoutEvents[kind] = [...referenceEvents,
    'layout-reference-target-observed', 'layout-reference-unchanged', 'layout-reference-target-missing',
    'layout-reference-target-removed', 'layout-reference-origin-unconfirmed', 'layout-reference-child-attached', 'layout-reference-child-replaced', 'layout-container-wrapper-zero-class-emitted'];
for (const [kind, events] of Object.entries(layoutEvents)) {
    if (kind.startsWith('asset-') && !kind.startsWith('asset-removal')) events.push('layout-asset-controller-origin-unconfirmed', 'layout-asset-storage-unconfirmed', 'layout-asset-emission-unconfirmed');
}
for (const kind of ['asset-src', 'asset-src-type']) layoutEvents[kind].push('layout-asset-controller-url-generated');
for (const events of Object.values(layoutEvents)) events.push('layout-file-provider-excluded', 'layout-file-overridden', 'layout-xml-ownership-revoked', 'layout-validation-failed', 'layout-origin-limit');
const layoutDecisions = {
    'layout-file-provider-excluded': 'Magento’s native module output filter excluded this provider from the effective layout file list.',
    'layout-configured-operand-origin-unconfirmed': 'The native configured object argument or constructor handoff has no uniquely verified source.',
    'layout-action-item-origin-unconfirmed': 'The nested action array operand has no uniquely verified native evaluation.',
    'layout-parameter-overridden': 'A later parameter replaced this operand in Magento’s named parameter map.',
    'layout-parameter-value-inherited': 'This empty overlay supplied the name while Magento retained the earlier parameter value.',
    'layout-parameter-origin-unconfirmed': 'The native parameter input or evaluator has no uniquely verified original source.',
    'layout-argument-group-ignored': 'The native block reader selects only its first arguments group. This later group and its descendants supplied no values through that read.',
    'layout-argument-group-failed': 'The native argument group read failed before returning its parsed argument map.',
    'layout-argument-group-origin-unconfirmed': 'A custom group selector, parser or XML handoff did not establish the original group consumed by the reader.',
    'layout-argument-type-deferred': 'The native reader selected its pass-through interpreter for this original type. Concrete value interpretation is deferred; selection alone earns zero evaluation hits.',
    'layout-argument-type-failed': 'Native interpretation selected this type but failed before completing evaluation.',
    'layout-argument-modifier-deferred': 'The native reader preserved this modifier for a later interpreter; it has not established modifier evaluation.',
    'layout-argument-modifier-failed': 'The native modifier consumer failed before completing its evaluation.',
    'layout-argument-modifier-origin-unconfirmed': 'The native interpreter handoff does not uniquely establish this original modifier operand.',
    'layout-argument-type-ambiguous': 'Multiple original action operands match this native argument evaluation. No single original type field can receive evaluation credit.',
    'layout-argument-modifier-ambiguous': 'Multiple original action operands match this native argument evaluation. No single original modifier field can receive evaluation credit.',
    'layout-argument-type-origin-unconfirmed': 'The type dispatch used an unverified selector or native input handoff. No original type evaluation is credited.',
    'layout-position-name-defaulted': 'Native scheduling ignores the empty or zero name and generates an anonymous identifier. The original name operand did not assign that identifier; the declaration retains independent creation and rendering evidence.',
    'layout-template-assignment-origin-unconfirmed': 'The action call did not establish a unique native template assignment from this original argument. Custom setters, plugins, storage and ambiguous calls retain no template execution credit.',
    'layout-template-constructor-origin-unconfirmed': 'The native constructor data, value getter or template setter did not establish this original argument as the template selection. Argument application and reads remain independent.',
    'layout-template-empty-ignored': 'The native block generator treats the original empty string or zero template spelling as empty and skips its template assignment. Any PHP default template has a separate origin.',
    'layout-block-group-empty-ignored': 'The native block generator treats this empty string or zero group name as empty and skips group registration.',
    'layout-block-ttl-empty-ignored': 'The native block generator treats the zero TTL spelling as empty and skips its assignment. A constructor or other provider can retain its own TTL.',
    'layout-display-empty-ignored': 'The native block generator treats the original zero display spelling as empty and skips the structural attribute. Container display processing has different semantics.',
    'layout-removal-empty-ignored': 'The native reference reader treats the empty or zero remove spelling as false in both its removal and cancellation branches. It leaves any earlier removal queued.',
    'layout-argument-name-overridden': 'A later declaration replaced the value associated with this original parser key before its native block-data assignment.',
    'layout-argument-name-mixed-origin': 'The value at this parser key combines original declarations. The assignment cannot choose one complete original name operand.',
    'layout-argument-name-origin-unconfirmed': 'The native value or assignment handoff does not establish this original name operand for the applied key.',
    'layout-action-argument-name-ambiguous': 'Multiple original actions can supply this parsed argument key and position. The native call does not identify one original operand.',
    'layout-action-argument-name-origin-unconfirmed': 'The action argument interpreter handoff does not establish this original parser key for the call.',
    'layout-template-resolver-storage-unconfirmed': 'The template resolver backing property has hooks, unset storage, pending lazy initialization or no verified object. Reading it for attribution could execute application code; original template execution remains unconfirmed.',
    'layout-template-context-storage-unconfirmed': 'The template context backing property has hooks, unset storage, pending lazy initialization or no verified object. The native engine context cannot be matched without invoking application code.',
    'layout-template-engine-pool-storage-unconfirmed': 'The template engine pool backing property has hooks, unset storage, pending lazy initialization or no verified object. Its selection handoff cannot be inspected without invoking application code.',
    'layout-reference-unchanged': 'This empty reference matched a native structural target and supplied no operation.',
    'layout-reference-target-missing': 'The named reference target was absent at the observed native structural-build boundary.',
    'layout-reference-target-removed': 'The named reference target was removed at the observed native structural-build boundary.',
    'layout-reference-origin-unconfirmed': 'The reference reader, XML name accessor or structural storage lacks a verified native handoff. Independent descendant facts remain separate.',
    'layout-reference-child-replaced': 'A later native schedule or parenting write replaced this original child-parent assignment, including equal-valued writes.',
    'layout-block-registration-origin-unconfirmed': 'The block registration passed through an unverified setter or scope-dependent generated implementation. The resulting layout element has no verified original registration origin.',
    'layout-handle-metadata-returned': 'The native API returned a handle metadata snapshot. Later PHP array offsets and classification calls do not preserve per-field origin identity.',
    'layout-handle-metadata-overridden': 'A later package entry with the same handle replaced this metadata in the native result map.',
    'layout-handle-metadata-origin-unconfirmed': 'The metadata API passed through an unverified implementation or plugin. Native field evaluation and final result ownership remain separate.',
    'layout-block-render-origin-unconfirmed': 'A shared block object has multiple original layout declarations. A direct PHP render lacks a unique layout element origin.',
    'layout-block-cache-unconfirmed': 'The native block HTML cache path supplied data while fresh template execution was bypassed. The original source of the cached bytes is unverified.',
    'layout-template-cache-unconfirmed': 'Cached block HTML bypassed this selected template. Cached bytes do not establish fresh original XML template execution.',
    'layout-template-field-access-unconfirmed': 'Template storage is opaque or publicly writable/promoted, or a custom block implementation or scoped closure can access it outside the observed native accessors. Those accesses are not traced; an equal filename cannot establish original XML execution ownership.',
    'layout-template-origin-unconfirmed': 'The rendering input passed through an unverified template getter, filename resolver or PHP template engine handoff, or template validation supplied no attributable native decision. Native XML selection cannot establish original template execution ownership. Hooked or magic property storage can replace the selection even when values match.',
    'layout-argument-application-unconfirmed': 'Block creation passed evaluated values through an unverified implementation, plugin or hooked, magic or uninitialized lazy data storage. Their later application lacks verified original ownership.',
    'layout-argument-field-access-unconfirmed': 'A custom block implementation or scoped closure can access data storage outside the observed native data accessors or cannot be inspected. Those accesses are not traced; earlier application remains proven, while equal values cannot establish original XML read lineage.',
    'layout-argument-storage-unconfirmed': 'The block data property became hooked, unset, magic or subject to unverified lazy initialization. Original application evidence is retained; later reads lack verified XML lineage.',
    'layout-block-class-defaulted': 'The native generator selected its configured default class after treating the XML attribute as empty.',
    'layout-block-class-storage-unconfirmed': 'Pending lazy initialization, property hooks or unset block-factory/object-manager storage prevents passive verification of the native producer. Original class ownership remains unconfirmed.',
    'layout-block-class-origin-unconfirmed': 'Block creation used an unverified factory, object-manager dependency or intercepted creation method. Original-source class ownership is unavailable.',
    'layout-argument-origin-unconfirmed': 'The argument interpreter chain includes an unverified implementation or intercepted method. Original-source value ownership is unavailable for this argument tree.',
    'layout-origin-limit': 'Runtime layout document tracking reached its 256-document bound before this declaration could receive original-source evidence.',
    'layout-ui-denied': 'The native visibility decision removed this UI placement before component generation.',
    'layout-condition-unconfirmed': 'The custom condition source lacks a unique native composite, rule-key or bounded argument binding.',
    'layout-condition-name-unused': 'The native rule used another condition key to retrieve its arguments.',
    'layout-condition-argument-unconsumed': 'This rule retrieved its arguments from another XML condition key.',
    'layout-condition-failed': 'The native visibility rule call failed before returning a decision.',
    'layout-validation-failed': 'Native merged-layout validation stopped construction before this instruction could execute.',
    'layout-registry-overridden': 'A later native registry write supplied the field used by the consumer.',
    'layout-registry-label-ignored': 'The native label merge applied no replacement text and preserved the preceding label fragments.',
    'layout-registry-label-unconfirmed': 'The mixed-content label merge lacks complete native text assignment evidence.',
    'layout-registry-snapshot-returned': 'The native API returned the whole registry map. Individual entry and label consumption is unobserved on that path.',
    'layout-registry-cache-unconfirmed': 'This registry input lacks a verified native file-read lineage in the current request.',
    'layout-file-selected': 'Magento selected this file as merged layout input. Descendant declarations require their own native effect evidence.',
    'layout-xml-ownership-revoked': 'Mutable layout XML reached external PHP or an unverified reader or parser, or was reassigned before native interpretation, so original ownership could not be retained.',
    'layout-position-replaced': 'A later native structure operation replaced this declaration identity, alias or sibling order.',
    'layout-position-ignored': 'The native scheduling helper selected after and ignored this before attribute.',
    'layout-position-order-unchanged': 'The native ordering operation left the child order unchanged.',
    'layout-updater-ignored': 'The native argument parser omitted this updater from the argument metadata.',
    'layout-updater-failed': 'The native updater call failed before returning a value.',
    'layout-updater-ambiguous': 'Multiple argument origins supplied identical updater metadata at the native interpreter boundary.',
    'layout-block-reading-failed': 'The native block reader failed before completing scheduling and argument interpretation.',
    'layout-argument-mixed-origin': 'The assembled argument retains multiple or unconfirmed XML contributors, so its parent has no unique application origin.',
    'layout-argument-overridden': 'A later XML value replaced this argument before native value generation.',
    'layout-argument-identity-unconfirmed': 'Value correlation is bounded to 1024 nodes, 32 nested levels and 64 KiB of string/key bytes; closed resources lack a supported identity.',
    'layout-file-override-unconfirmed': 'The override source was selected without an attributable native file-list replacement.',
    'layout-file-overridden': 'A selected native file-list replacement displaced this source in the effective theme.',
    'layout-asset-attributes-discarded': 'The native font renderer supplied its fixed preload attributes and discarded these XML attributes.',
    'layout-body-class-duplicate': 'The native body class assignment found this sanitized class already present.',
    'layout-body-class-canceled': 'An empty class assignment suppressed all scheduled XML body classes, including later additions.',
    'layout-body-class-replaced': 'A runtime body class assignment replaced the XML-origin class list before output.',
    'layout-asset-overridden': 'A later declaration replaced this scheduled resource before native asset output.',
    'layout-asset-replaced': 'A runtime assignment replaced this scheduled XML resource before native asset output.',
    'layout-asset-storage-unconfirmed': 'The native asset collection storage or asset getter result could not be attributed to this XML declaration.',
    'layout-asset-emission-unconfirmed': 'The renderer did not verify that the native asset URL contributed to the returned tag.',
    'layout-asset-controller-origin-unconfirmed': 'The native controller asset handoff did not establish the original route-to-URL conversion.',
    'layout-asset-removed-before-output': 'The native removal pass removed this scheduled resource before asset generation.',
    'layout-block-render-failed': 'The native block rendering boundary threw before returning HTML. Construction remains a separate observed fact.',
    'layout-block-generation-failed': 'Native block generation failed before completing construction and data application.',
    'layout-block-attribute-overridden': 'A later declaration supplied the block attribute used by the native generator.',
    'layout-block-ttl-origin-unconfirmed': 'The native TTL setter reached hooked, magic or uninitialized lazy data storage. Its assignment lacks verified original XML ownership.',
    'layout-cacheability-target-missing': 'The native cacheability check found that the noncacheable declaration had no surviving structural element.',
    'layout-template-validation-rejected': 'The native template file validator rejected the effective file at the original template fetch boundary. No PHP template execution occurred on this path.',
    'layout-template-failed': 'The native template fetch boundary failed. Any independently completed engine execution remains a separate fact.',
    'layout-template-replaced': 'A later PHP template assignment replaced this XML selection before template execution.',
    'layout-container-attribute-overridden': 'A later container declaration supplied the attribute used during generation.',
    'layout-container-attribute-replaced': 'A runtime structure assignment replaced this XML attribute before its native rendering boundary.',
    'layout-page-attribute-overridden': 'A later page configuration assignment replaced this element attribute.',
    'layout-metadata-overridden': 'A later page configuration assignment replaced this metadata entry.',
    'layout-page-attribute-replaced': 'A runtime assignment replaced this XML element attribute before its native rendering boundary.',
    'layout-metadata-replaced': 'A runtime assignment replaced this XML metadata before its native rendering boundary.',
    'layout-action-condition-ambiguous': 'More than one native scheduled action has this guard path and scope. The observed decision cannot identify a unique original operand, including unmapped dynamic actions.',
    'layout-action-condition-empty-ignored': 'Native action generation short-circuits the empty or zero guard without consulting configuration. The independent action call retains its own evidence.',
    'layout-action-condition-unobserved': 'The original guard was supplied, but no uniquely attributable native scope decision or completed short-circuited call was observed.',
    'layout-action-condition-origin-unconfirmed': 'The native action snapshot, generator, scheduled storage or original action list could not establish this guard operand. No value equality inference is made.',
    'layout-action-condition-failed': 'The attributed native configuration flag call failed before it returned a guard decision.',
    'layout-action-evaluation-failed': 'Native action generation failed during argument evaluation. No call completion or method body execution is established.',
    'layout-action-completion-failed': 'Native action generation failed after argument evaluation completed. This boundary cannot establish method body entry, successful call completion or partial side effects.',
    'layout-action-argument-evaluation-incomplete': 'The native action argument batch failed. This boundary does not establish which individual values finished evaluation before the failure.',
    'layout-action-argument-name-evaluation-incomplete': 'The native action argument batch failed before a complete evaluated key map was observed.',
    'layout-action-origin-unconfirmed': 'The effective native process action snapshot did not establish the original source of this call.',
    'layout-action-ambiguous': 'Multiple scheduled actions match the native method and arguments; the executed declaration could not be identified.',
    'layout-action-argument-ambiguous': 'Multiple scheduled actions supplied matching arguments, preventing a unique original parameter origin.',
    'layout-argument-replaced': 'A runtime data write revoked this XML value origin before a later native getter could consume it.',
    'layout-title-empty-ignored': 'The native head generator skipped assigning the effective empty or zero title.',
    'layout-metadata-template-skipped': 'Magento skipped emitting a tag for this metadata key at the native template selector.',
    'layout-metadata-content-fallback': 'Magento used a fallback getter result in place of this empty XML content.',
    'layout-metadata-origin-unconfirmed': 'The native metadata getter path did not establish that the output came from the original content.',
    'layout-metadata-empty-suppressed': 'The native metadata renderer suppressed the effective empty or zero content.',
    'layout-page-attribute-removed-before-output': 'The native removal pass discarded this scheduled attribute before it could reach the renderer.',
    'layout-page-attribute-removal-target-missing': 'The native removal queue found no remaining value for this element attribute.',
    'layout-title-overridden': 'A later title replaced this declaration before the page configuration was applied.',
    'layout-title-replaced': 'A runtime title assignment replaced this declaration before attribution at the renderer.',
    'layout-asset-removal-target-missing': 'The scheduled removal had no asset in the native page configuration.',
    'layout-removal-canceled': 'Magento canceled this scheduled removal before generating the structure.',
    'layout-move-origin-unconfirmed': 'The native move schedule or structure uses customized storage or accessors without a verified original-source handoff.',
    'layout-move-replaced': 'A later programmatic schedule write replaced this move, including an equal-valued tuple.',
    'layout-move-overridden': 'A later XML move replaced this scheduled move before execution.',
    'layout-move-destination-missing': 'The requested destination was absent. The native move could detach its existing source but could not apply this destination, alias or order.',
    'layout-move-alias-unchanged': 'The native move retained the existing child alias.',
    'layout-move-order-unchanged': 'The native destination reorder left its child order unchanged.',
    'layout-move-ignored': 'The native move reader selected after and ignored this before attribute.',
    'layout-move-target-missing': 'The scheduled move had no target in the structure Magento built.',
    'layout-move-unchanged': 'The native move left the parent, alias and sibling order unchanged.',
    'layout-move-unresolved': 'The scheduled move did not establish the requested parent.',
    'layout-wireframe-origin-unconfirmed': 'The page-layout getter or active plugin lacks a verified original-source handoff. An equal result alone cannot establish ownership; selector identities longer than 4096 bytes are also unmeasured.',
    'layout-template-overridden': 'A later declaration supplied the template used during block generation',
    'layout-include-duplicate': 'Magento had already processed the included handle',
    'layout-include-cycle': 'Magento was processing the included handle and skipped recursive re-entry',
    'layout-include-missing': 'Magento found no package or database layout update for the handle',
};
const layoutObservations = new Set(['layout-block-created', 'layout-template-selected', 'layout-reference-target-observed']);
const countsAsLayoutCoverage = type => !Object.hasOwn(layoutDecisions, type) && !layoutObservations.has(type);
const layoutLimitations = {
    'layout-file-replacement-descriptor-unconfirmed': 'A replacement file descriptor has a custom filename accessor, hooked or unset filename storage, pending lazy initialization or no verified string. Original replacement ancestry is unconfirmed; independently verified file reads retain their own evidence.',
    'layout-file-replacement-storage-unconfirmed': 'The native file-list backing storage has hooks, unset storage, pending lazy initialization or no verified array. Replacement ancestry cannot be inspected without executing application code; independently verified file reads retain their own evidence.',
    'layout-programmatic-update': 'A native programmatic XML update appended input without original file provenance.',
    'full-page-cache-origin': 'A native full-page cache lookup returned a response. Its original XML/template lineage and fresh layout execution are unverified.',
    'block-html-cache-origin': 'A native block HTML cache lookup returned data. Its original XML/template lineage is unverified.',
    'layout-nonstring-update': 'A native update list contained a non-string value. Original-source alignment would require repeating application conversion, so its XML origins were withheld.',
    'layout-processor-unconfirmed': 'A layout processor implementation falls outside the verified native merge path.',
    'layout-opaque-action-data': 'Native scheduled action data contains opaque values or exceeds the reviewed scalar-tree depth. Inspecting it could execute application serialization; original action attribution is withheld on this path.',
    'layout-theme-context-unconfirmed': 'Native file resolution returned no bounded area or theme path for original-source layout evidence.',
    'layout-shared-block-origin': 'A shared block object was rendered directly without a uniquely attributable layout element. Native element rendering and template execution retain independent evidence.',
    'layout-block-registration-origin': 'A native block registration used an unverified setter handoff. Block construction and template execution retain independent evidence; layout element render attribution requires a verified registration.',
    'layout-database-update': 'Magento appended a database layout update through its native merge path. Database and widget row origins have no original XML file location; displaced file effects lose ownership.',
    'layout-cms-update': 'The native CMS helper appended a CMS layout update from page data. Its inline or dated custom values have no original XML file location; surviving file effects retain independent evidence.',
    'layout-handle-metadata-snapshot': 'Magento returned a handle metadata snapshot. Native XML field evaluation is measured; later individual PHP array reads and classification calls lack source identity.',
    'mutable-layout-package': 'External PHP or an unverified getter received mutable package layout XML. Future selected entries lack verified original ownership.',
    'layout-serialization-unconfirmed': 'Layout serialization or XML conversion used an unverified implementation or plugin. Evidence is limited to independently confirmed native calls.',
    'layout-updates-reset': 'A discarded native update list was used again after reset without current original-source lineage.',
    'layout-document-limit': 'Runtime layout origin tracking is bounded to 256 retained XML documents per request.',
    'layout-condition-hook-limit': 'Runtime visibility hooks are bounded to 1024 declaring classes per request.',
    'layout-validation-failed': 'Native merged-layout validation stopped this layout instance before interpretation.',
    'layout-validation-warning': 'Native merged-layout validation logged a schema failure and continued in the current application mode.',
    'layout-registry-custom-provider': 'A customized registry builder or configuration implementation lacks verified source and native consumer boundaries.',
    'layout-registry-cache': 'The registry reused inputs without current native file-read provenance.',
    'layout-registry-limit': 'Registry tracing is bounded to 512 files, 2 MiB of input XML and 16384 retained DOM nodes per request.',
    'layout-registry-complex-label': 'A mixed-content registry label merge lacks complete native text assignment evidence.',
    'layout-registry-data-replaced': 'A runtime registry data assignment revoked the original XML ownership.',
    'layout-page-types-cache': 'Page type configuration reused cached or replaced data without current native file-read provenance.',
    'layout-registry-context': 'The registry consumer lacked a uniquely associated native layout context or verified source state.',
    'mutable-layout-xml': 'External PHP, a custom or intercepted reader, or an unverified parser received mutable layout XML. Direct and equal-valued replacements cannot retain verified original declaration ownership.',
    'layout-package-cache': 'Magento reused a package layout cache entry without original file positions.',
    'layout-merge-cache': 'Magento reused a merged handle update without original declaration positions.',
    'scheduled-layout-cache': 'Magento populated the layout schedule from cache without running the layout readers.',
    'missing-layout-origins': 'A generated layout had no confirmed trace from original files to its schedule.',
};
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
            declarations.set(item.id, {item, source: file.path});
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
    const diTotals = {};
    for (const [family, details] of Object.entries(diFamilies)) {
        const enabled = Object.values(manifest.preferences || {}).some(area => Object.keys(area.diUsage?.eligible?.[family] || {}).length);
        const hook = records.some(record => record.diUsageHooks?.[family] === true);
        assert.ok(!enabled || hook, `No functioning XML ${details.title.toLowerCase()} hook observed`);
        diTotals[family] = {total: 0, covered: 0, hook};
    }
    const layoutHook = records.some(record => record.layoutHook === true);
    const layoutSourceTrace = records.some(record => record.layoutSourceTrace === true);
    const layoutTotals = {total: 0, covered: 0, hook: layoutHook, limitations: []};
    const layoutMeasurement = [...declarations.values()].some(({item}) => item.family === 'layout' && item.supported);
    assert.ok(!layoutMeasurement || layoutHook, 'No functioning XML layout hook observed');
    const requestLimitations = new Set();
    const requests = [];
    const commands = new Map();
    const warnings = [];
    for (const record of records) {
        assert.equal(record.run, manifest.run, 'Stale XML request');
        assert.equal(record.manifest, manifest.id, 'XML manifest mismatch');
        const url = new URL(record.uri || '/', 'https://application.invalid');
        let scenario = url.searchParams.get('case');
        if (!/\/blog\/index\/configuration\/?$/.test(url.pathname) || !cases.has((scenario || '').replace(/-warm$/, ''))) scenario = null;
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
        for (const [id, areas] of Object.entries(record.ambiguousPlugins || {})) {
            assert.equal(record.pluginHook, true);
            for (const [area, callbacks] of Object.entries(areas)) for (const [key, seen] of Object.entries(callbacks)) {
                assert.equal(seen, true);
                pluginCallback(declarations.get(id)?.item, area, key).callback.ambiguousEntry = true;
            }
        }
        for (const event of record.events) {
            const {item, source} = declarations.get(event.id) || {};
            assert.ok(item?.supported || (item?.family === 'layout' && item.layout.kind === 'file-selection'), 'Unknown or unmeasured XML evidence');
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
            if (item.family !== 'layout' || countsAsLayoutCoverage(event.type)) item.hits += event.hits;
            const sameEvidence = previous => item.family === 'layout'
                ? previous.type === evidence.type && previous.area === evidence.area && previous.theme === evidence.theme
                : JSON.stringify(previous) === JSON.stringify(evidence);
            if (!item.evidence.some(sameEvidence)) item.evidence.push(evidence);
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
            if (item.family === 'layout') {
                const decisions = [...new Set(item.evidence.map(event => layoutDecisions[event.type]).filter(Boolean))].sort();
                if (item.supported && decisions.length) item.reason = decisions.join('. ');
                if (item.supported && !item.hits && decisions.length) {
                    item.state = 'unmeasured';
                } else if (item.state === 'uncovered' && !layoutSourceTrace
                    && [...requestLimitations].some(key => key !== 'full-page-cache-origin')) {
                    item.state = 'unmeasured';
                    item.reason = 'No measured layout request supplied a source trace';
                }
                if (item.state !== 'unmeasured') layoutTotals.total++;
                if (item.state === 'covered') layoutTotals.covered++;
                if (item.state === 'unmeasured' || decisions.length) warnings.push({path: file.path, declaration: item.id, reason: item.reason});
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
        const lines = ['plugins', 'layout'].includes(file.family) ? [] : Object.values(file.lines).filter(line => line.state !== 'unmeasured');
        file.total = lines.length; file.covered = lines.filter(line => line.hits > 0).length;
    }
    layoutTotals.limitations = [...requestLimitations].sort().map(key => layoutLimitations[key]);
    const total = files.reduce((sum, file) => sum + file.total, 0);
    const covered = files.reduce((sum, file) => sum + file.covered, 0);
    return {schemaVersion: 1, run: manifest.run, manifest: manifest.id, complete: true, sourcesUnchanged: true,
        collectorErrors: [], observers: {...observerTotals, hook: observerHook}, plugins: {...pluginTotals, hook: pluginHook},
        preferences: {...preferenceTotals, hook: preferenceHook}, layout: layoutTotals,
        ...Object.fromEntries(Object.entries(diFamilies).map(([family, details]) => [details.key, diTotals[family]])), total, covered, percent: total ? covered / total * 100 : 0, warnings, files, requests};
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
function diSections(result, files) {
    return Object.entries(diFamilies).map(([family, details]) => {
        const {covered, total} = result[details.key] ?? {covered: 0, total: 0};
        const rows = result.files.flatMap(file => file.declarations.filter(item => item.family === family).map(item =>
            `<li>${bindingLabel(item)}<small><a href="${escape(sourceHref(file.path, item.startLine))}">${escape(file.path)} · ${lineLabel(item)}</a></small>
                ${preferenceAreas(item, files, '')}</li>`));
        const content = rows.length
            ? `<p>${covered}/${total} eligible declaration–area pairs ${details.action}. These pairs sit outside the XML line totals.</p>
                ${total ? '' : '<p>All inventoried declarations are unmeasured in the supported areas.</p>'}
                <ul class="preference-list">${rows.join('')}</ul>`
            : '<p>No matching declarations in the XML source inventory.</p>';
        return `<section class="preferences" aria-labelledby="${family}-usage"><h2 id="${family}-usage">${details.title}</h2>${content}</section>`;
    }).join('');
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
            if (item.family === 'preferences' || Object.hasOwn(diFamilies, item.family)) {
                return `<tr><td>${bindingLabel(item, label => `<a href="#L${item.startLine}">${label}</a>`)}
                    <small>Original ${lineLabel(item)}</small></td><td>${preferenceAreas(item, files, prefix)}</td></tr>`;
            }
            if (item.family === 'layout') {
                const {element, handle, fileType, selection, destination} = item.layout;
                const outcomes = item.evidence.map(event =>
                    `<small>${escape(event.type.replace(/^layout-/, '').replaceAll('-', ' '))}${layoutObservations.has(event.type) ? ' · observed fact' : ''} · ${escape(event.theme)}</small>`).join('');
                return `<tr><td><a href="#L${item.startLine}">${escape(item.path)}</a><small>${escape(selection || element)}${destination ? ' → ' + escape(destination) : ''} · ${escape(handle)} · ${escape(fileType)} · ${lineLabel(item)}</small></td><td>${escape(item.state)}${outcomes}<small>${escape(item.reason || '')}</small></td></tr>`;
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
        fs.writeFileSync(target, page(file.path, `<p><a href="index.html">Directory</a> · ${file.family === 'plugins' ? 'DI declarations by area' : file.family === 'layout' ? 'Layout declarations' : `${file.covered}/${file.total} supported lines covered`}</p><p>${escape(file.reason || '')}</p><table${file.family === 'plugins' ? ' class="di-details"' : ''}>${details}</table><pre>${lines}</pre>`));
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
        const rows = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([href, entry]) => `<tr><td><a href="${escape(href)}">${escape(entry.label)}</a></td><td>${entry.file && entry.file.family !== 'layout' ? `${entry.file.covered}/${entry.file.total}` : ''}</td></tr>`).join('');
        const top = name ? '<p><a href="../index.html">Parent directory</a></p>' : `<p>${result.covered}/${result.total} supported lines covered (${result.percent.toFixed(2)}%). <a href="coverage.json">JSON</a></p><p>${result.observers.covered}/${result.observers.total} eligible observer registrations executed across areas.</p><p>${result.plugins.covered}/${result.plugins.total} eligible plugin registrations executed across areas. Each declaration contributes once per eligible area; its source highlight summarizes all areas and is excluded from line totals.</p><p>${result.layout.covered}/${result.layout.total} eligible layout declarations with observed effects. Block creation and template selection are retained as facts; their declarations require native block rendering or template execution for coverage. ${result.layout.limitations.map(escape).join(' ')}</p><p>Green: observed during a config read, Admin field render, observer execution, plugin execution or DI usage. Red: eligible and unobserved. Grey: unmeasured. XML loading grants no credit. Section/group wrappers are neutral. ${result.warnings.length} measurement warnings; inspect source details and JSON.</p>`;
        fs.mkdirSync(path.join(directory, name), {recursive: true});
        fs.writeFileSync(path.join(directory, name, 'index.html'), page(name || 'XML configuration coverage', top + `<table>${rows}</table>` + (name ? '' : preferenceSection(result, files) + diSections(result, files))));
    }
    fs.writeFileSync(path.join(directory, 'coverage.json'), JSON.stringify(result, null, 2));
}
function readSources(files) {
    const root = fs.realpathSync('src');
    return Object.fromEntries(files.map(file => {
        assert.match(file.path, /^(app\/code|app\/design|vendor)\//);
        assert.ok(!file.path.split('/').some(part => part === '..' || part === '.'));
        const filename = path.join(root, file.path);
        assert.equal(fs.realpathSync(filename), filename, `Symlinked XML source: ${file.path}`);
        return [file.path, fs.readFileSync(filename)];
    }));
}

function report() {
    const read = file => JSON.parse(fs.readFileSync(file));
    assert.equal(fs.existsSync('coverage/.active-run'), false, 'Stop and drain collection before XML reporting');
    const run = read('coverage/run.json'), manifest = read('coverage/xml-manifest.json');
    assert.equal(run.id, manifest.run);
    const raw = `coverage/raw/php/${run.id}`;
    assert.ok(!fs.readdirSync(raw).some(file => file.endsWith('.error')), 'Failed PHP collection');
    const metadata = fs.readdirSync(raw).filter(file => /^[a-f0-9]+(?:\.[1-9]\d*)?\.json$/.test(file));
    const records = metadata.map(file => {
        const request = read(`${raw}/${file}`);
        assert.ok(request.xml, 'Missing XML runtime evidence');
        if (request.commandId) {
            assert.equal(request.commandId, file.split('.')[0], 'Mismatched CLI XML record');
            assert.ok(['magento', 'magerun'].includes(request.tool), 'Invalid CLI XML tool');
        }
        return {...request.xml, uri: request.uri, tool: request.commandId ? request.tool : undefined, request: request.commandId ?? file.slice(0, -5)};
    });
    const sources = readSources(manifest.files);
    const result = merge(manifest, records, sources);
    writeReport(result, sources);
    return result;
}
module.exports = {merge, writeReport, report, layoutEvents, countsAsLayoutCoverage};
if (require.main === module) report();
