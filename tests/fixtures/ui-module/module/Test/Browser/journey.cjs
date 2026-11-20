// Copyright (c)  MageLens
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const listing = 'magelens_ui_probe_listing';
const form = 'magelens_ui_probe_form';
const parent = '#menu-magelens-uiprobe-screens > a';
const menu = name => `[data-ui-id="menu-magelens-uiprobe-${name}"] > a`;
const columns = `${listing}.${listing}.probe_columns.`;
const fields = `${form}.${form}.probe_fields.`;
const provider = `${listing}.probe_data_source#provider`;
const grid = 'table[data-role=grid]';
const gridHead = `${grid} thead th`;
const rows = `${grid} tbody tr.data-row td:first-child`;
const input = 'input[name=untouched]';
const button = name => `button[data-index=${name}]`;
const responseId = /^[a-f0-9]{32}$/;
const testValue = 'Browser fixture edit';

function documentResponse(win = window) {
    return win.performance.getEntriesByType('navigation')[0]?.serverTiming
        .find(entry => entry.name === 'magelens-response')?.description;
}

function sortingRequest(url) {
    const request = new URL(url);
    if (!/\/mui\/index\/render(?:\/|$)/.test(request.pathname) ||
        request.searchParams.get('namespace') !== listing ||
        request.searchParams.get('sorting[field]') !== 'untouched') return null;
    return request.searchParams.get('sorting[direction]')?.toLowerCase() ?? null;
}

function expectedEffects(identities, types) {
    return identities.flatMap(identity => types.map(type => ({identity, type})));
}

const listingEffects = expectedEffects(['untouched', 'equal', 'replaced'].map(name => columns + name), [
    'ui-constructed', 'ui-rendered'
]);
const formEffects = [
    ...expectedEffects(['untouched', 'invoke', 'uninvoked'].map(name => fields + name), ['ui-constructed', 'ui-rendered']),
    {identity: fields + 'invoke', type: 'ui-action-invoked'},
];

module.exports = {parent, menu, listingEffects, formEffects, columns, fields, provider, gridHead, rows,
    input, button, responseId, documentResponse, sortingRequest, testValue};
