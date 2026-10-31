// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

define(['uiComponent', 'ko'], function (Component, ko) {
    'use strict';
    return Component.extend({
        defaults: {template: 'Vitalii_TodoList/list'},
        initialize: function () {
            this._super();
            this.draft = ko.observable('');
            this.tasks = ko.observableArray([]);
            return this;
        },
        add: function () {
            var text = this.draft().trim();
            if (!text) return;
            this.tasks.push({text: text, done: ko.observable(false)});
            this.draft('');
        },
        remove: function (task) {
            this.tasks.remove(task);
        }
    });
});
