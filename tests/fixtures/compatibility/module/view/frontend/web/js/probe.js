// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

window.probeRequest = async function (url, formKey, value) {
    const cookie = document.cookie.split('; ').find(value => value.startsWith('form_key='));
    const currentKey = window.hyva?.getFormKey?.() || (cookie ? decodeURIComponent(cookie.slice('form_key='.length)) : formKey);
    const response = await fetch(url, {method: 'POST', body: new URLSearchParams({form_key: currentKey, value})});
    if (!response.ok) throw new Error('Probe save failed');
    return response.json();
};
window.coverageProbe = function (url, formKey) {
    return {name: 'initial', count: 0, saved: '', open: false, items: ['one', 'two'],
        neverLabel: 'never executed', image: 'initial', price: 'initial',
        get nameModel() { return {get: () => this.name, set: value => {this.name = value;}}; },
        init() { url = url || this.$el.dataset.saveUrl; formKey = formKey || this.$el.dataset.formKey; },
        increment() { this.count++; },
        updateImage(event) { this.image = event.detail; },
        updatePrice(event) { this.price = event.detail; },
        async save() { this.saved = (await window.probeRequest(url, formKey, this.name)).message; },
        unused() { throw new Error('Unvisited method'); }
    };
};

document.addEventListener('alpine:init', () => Alpine.data('coverageProbe', () => window.coverageProbe()));

// Run from a normally loaded application asset, outside DevTools evaluation.
window.__magelensEvalBlocked = false;
try { Function('return 42')(); }
catch (error) { window.__magelensEvalBlocked = error.name === 'EvalError'; }
