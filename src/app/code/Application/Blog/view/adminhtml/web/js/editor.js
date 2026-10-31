// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

define(['uiComponent', 'ko', 'jquery'], function (Component, ko, $) {
    'use strict';
    return Component.extend({
        defaults: {template: 'Application_Blog/editor-preview'},
        initialize: function () {
            this._super();
            this.title = ko.observable('');
            this.summary = ko.observable('');
            this.words = ko.observable(0);
            this.status = ko.observable('draft');
            this.update = function () {
                this.title($('#blog-title').val());
                this.summary($('#blog-excerpt').val());
                var body = String($('#blog-body').val()).trim();
                this.words(body ? body.split(/\s+/).length : 0);
                this.status($('#blog-status').val());
            }.bind(this);
            $('#blog-edit').on('input change', this.update);
            this.update();
            return this;
        }
    });
});
