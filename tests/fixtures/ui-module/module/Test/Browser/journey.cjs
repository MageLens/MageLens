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
const columnLabels = [
    'Untouched column', 'Equal column', 'PHP replacement', 'Before prepare replacement',
    'Equal PHP column', 'After prepare replacement', 'Module theme label', 'Serialized replacement',
];
const rows = `${grid} tbody tr.data-row td:first-child`;
const input = 'input[name=untouched]';
const readOnly = 'span.admin__field-value[name=readonly]';
const initialValue = 'Fixture value';
const readOnlyValue = 'Read-only fixture value';
const proofDirectory = 'coverage/ui-browser-proof';
const button = name => `button[data-index=${name}]`;
const responseId = /^[a-f0-9]{32}$/;
const testValue = 'Browser fixture edit';
const initialDisabled = 'magelens_ui_probe_host.magelens_ui_probe_host.host_fields.initial_disabled';
const replacementButton = 'button[data-probe-replacement]';

function registerReplacement(identity, win = window) {
    return new Promise((resolve, reject) => {
        win.requirejs(['uiRegistry', 'ko', 'Magento_Ui/js/form/components/button'], (registry, ko, Button) => {
            try {
                if (registry.get(identity)) throw new Error('The client-disabled XML button was instantiated');
                const replacement = new Button({name: identity, actions: [{targetName: identity, actionName: 'mark'}]});
                const node = win.document.createElement('button');
                node.type = 'button';
                node.textContent = 'Replacement action';
                node.dataset.probeReplacement = '';
                node.setAttribute('data-bind', 'click: action');
                replacement.mark = () => { node.dataset.invoked = 'true'; };
                registry.set(identity, replacement);
                win.document.body.append(node);
                ko.applyBindings(replacement, node);
                resolve();
            } catch (error) {
                reject(error);
            }
        }, reject);
    });
}

function documentResponse(win = window) {
    return win.performance.getEntriesByType('navigation')[0]?.serverTiming
        .find(entry => entry.name === 'magelens-response')?.description;
}

function uiRequest(url) {
    const request = new URL(url);
    if (!/\/mui\/index\/render(?:\/|$)/.test(request.pathname)) return null;
    const namespace = request.searchParams.get('namespace');
    if (namespace === form) return 'form';
    if (namespace !== listing) return null;
    const sort = request.searchParams.get('sorting[field]');
    if (!sort) return 'initial';
    if (sort !== 'untouched') return null;
    return request.searchParams.get('sorting[direction]')?.toLowerCase() ?? null;
}

function expectedEffects(identities, types) {
    return identities.flatMap(identity => types.map(type => ({identity, type})));
}

const listingEffects = expectedEffects(['untouched', 'equal', 'replaced'].map(name => columns + name), [
    'ui-constructed', 'ui-rendered'
]);
const formEffects = [
    ...expectedEffects(['untouched', 'readonly', 'invoke', 'uninvoked'].map(name => fields + name), ['ui-constructed', 'ui-rendered']),
    {identity: fields + 'invoke', type: 'ui-action-invoked'},
];

module.exports = {parent, menu, listingEffects, formEffects, columns, fields, provider, gridHead, columnLabels, rows,
    input, readOnly, button, initialValue, readOnlyValue, proofDirectory, responseId, documentResponse, uiRequest, testValue, initialDisabled, replacementButton, registerReplacement};
