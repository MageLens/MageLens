// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

define(['uiComponent', 'ko'], function (Component, ko) {
    return Component.extend({
        defaults: {template: 'MageLens_Compatibility/probe'},
        initialize() {
            this._super();
            this.inputValue = ko.observable('initial');
            this.count = ko.observable(0);
            this.saved = ko.observable('');
            this.open = ko.observable(false);
            this.items = ['one', 'two'];
            return this;
        },
        increment() { this.count(this.count() + 1); },
        async save() { this.saved((await window.probeRequest(this.url, this.formKey, this.inputValue())).message); },
        unused() { throw new Error('Unvisited method'); }
    });
});
