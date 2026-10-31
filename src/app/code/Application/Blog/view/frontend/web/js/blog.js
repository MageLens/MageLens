// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

define(['uiComponent', 'ko', 'jquery', 'mage/template', 'text!Application_Blog/html/favorite.html'], function (Component, ko, $, renderTemplate, favoriteTemplate) {
    'use strict';
    return Component.extend({
        defaults: {template: 'Application_Blog/list', postsUrl: '', categories: []},
        initialize: function () {
            this._super();
            var params = new URLSearchParams(window.location.search), saved = [];
            try {
                saved = JSON.parse(window.localStorage.getItem('application.blog.favorites') || '[]');
                if (!Array.isArray(saved)) { saved = []; }
            } catch (error) { saved = []; }
            this.posts = ko.observableArray([]);
            this.query = ko.observable(params.get('q') || '');
            this.category = ko.observable(params.get('category') || '');
            this.page = ko.observable(1);
            this.pages = ko.observable(1);
            this.total = ko.observable(0);
            this.busy = ko.observable(false);
            this.message = ko.observable('');
            this.expanded = ko.observable(null);
            this.favorites = ko.observableArray(saved.filter(Number.isInteger));
            this.favoriteNotice = ko.observable('');
            this.loadPosts();
            return this;
        },
        search: function () {
            this.page(1);
            var params = new URLSearchParams();
            if (this.query()) { params.set('q', this.query()); }
            if (this.category()) { params.set('category', this.category()); }
            window.history.replaceState(null, '', window.location.pathname + (params.size ? '?' + params : ''));
            this.loadPosts();
        },
        loadPosts: function () {
            this.busy(true);
            this.message('');
            $.getJSON(this.postsUrl, {q: this.query(), category: this.category(), page: this.page()})
                .done(function (response) {
                    this.posts(response.posts);
                    this.page(response.page);
                    this.pages(response.pages);
                    this.total(response.total);
                    this.expanded(null);
                }.bind(this))
                .fail(function () {
                    this.posts([]);
                    this.total(0);
                    this.message('Could not load articles. Please try again.');
                }.bind(this))
                .always(function () { this.busy(false); }.bind(this));
        },
        next: function () { if (this.page() < this.pages()) { this.page(this.page() + 1); this.loadPosts(); } },
        previous: function () { if (this.page() > 1) { this.page(this.page() - 1); this.loadPosts(); } },
        toggleDetails: function (post) { this.expanded(this.expanded() === post.id ? null : post.id); },
        toggleFavorite: function (post) {
            if (this.favorites().includes(post.id)) {
                this.favorites.remove(post.id);
                this.favoriteNotice('');
            } else {
                this.favorites.push(post.id);
                this.favoriteNotice(renderTemplate(favoriteTemplate, {data: {title: post.title, note: ''}}));
            }
            try { window.localStorage.setItem('application.blog.favorites', JSON.stringify(this.favorites())); }
            catch (error) { this.message('Favorites are available for this visit only. Browser storage is unavailable.'); }
        }
    });
});
