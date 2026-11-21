// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const assert = require('node:assert/strict');

const familyNames = new Set(['ui-component', 'routes', 'webapi', 'acl', 'menu', 'cron']);
const areas = new Set(['global', 'frontend', 'adminhtml', 'webapi_rest', 'graphql', 'crontab']);
const observations = new Set(['observed', 'allowed', 'denied', 'matched', 'entered', 'completed', 'failed']);
const limitations = new Set(['ambiguous', 'displaced', 'cache-only', 'disabled']);
const effectName = /^[a-z]+(?:-[a-z]+)+$/;
const safeReason = /^(?=.{1,240}$)[^\u0000-\u001f\u007f]+$/;

function startFamilyDeclaration(item) {
    assert.ok(familyNames.has(item.family));
    assert.match(item.id, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(item.startLine) && item.startLine > 0);
    assert.ok(Number.isSafeInteger(item.endLine) && item.endLine >= item.startLine);
    assert.ok((item.highlightEndLine ?? item.endLine) >= item.startLine && (item.highlightEndLine ?? item.endLine) <= item.endLine);
    assert.ok(Array.isArray(item.effects) && new Set(item.effects).size === item.effects.length);
    assert.ok(item.effects.length || !item.supported);
    assert.ok(item.effects.every(type => effectName.test(type)));
    item.effectStates = Object.fromEntries(item.effects.map(type => [type, item.supported ? 'uncovered' : 'unmeasured']));
}

function countsAsFamilyCoverage(outcome) {
    return !limitations.has(outcome) && outcome !== 'failed';
}

function observeFamilyEffect(item, event, evidence) {
    assert.deepEqual(Object.keys(event).sort(), ['area', 'hits', 'id', 'outcome', 'reason', 'type']);
    assert.ok(item.effects.includes(event.type), 'Undeclared XML family effect');
    assert.ok(areas.has(event.area), 'Invalid XML family evidence area');
    const limited = limitations.has(event.outcome);
    assert.ok(limited || observations.has(event.outcome), 'Invalid XML family evidence outcome');
    if (limited) assert.ok(typeof event.reason === 'string' && safeReason.test(event.reason) && event.reason.trim());
    else assert.equal(event.reason, null);
    Object.assign(evidence, {area: event.area, outcome: event.outcome, reason: event.reason});
    const covered = countsAsFamilyCoverage(event.outcome);
    if (covered) item.effectStates[event.type] = 'covered';
    return covered;
}

function familyWarnings(item, path) {
    const warnings = item.evidence.filter(event => limitations.has(event.outcome)).map(event => ({
        path, declaration: item.id, area: event.area, effect: event.type, outcome: event.outcome, reason: event.reason
    }));
    return [...new Map(warnings.map(warning => [JSON.stringify(warning), warning])).values()];
}

function familyOutcomes(item) {
    return item.effects.map(type => {
        const seen = item.evidence.filter(event => event.type === type);
        const outcomes = seen.map(({area, outcome, reason}) => ({area, outcome, reason}));
        return {type, state: item.effectStates[type], outcomes: [...new Map(outcomes.map(row => [JSON.stringify(row), row])).values()]};
    });
}

module.exports = {startFamilyDeclaration, observeFamilyEffect, familyWarnings, familyOutcomes, countsAsFamilyCoverage};
