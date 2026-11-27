// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

'use strict';
window.applicationBlog = function (postsUrl) {
    return {
        posts: [], query: '', category: '', page: 1, pages: 1, total: 0,
        busy: true, message: '', expanded: null, favorites: [], favoriteNotice: '',
        neverVisible: false,
        get queryModel() { return {get: () => this.query, set: value => {this.query = value;}}; },
        get categoryModel() { return {get: () => this.category, set: value => {this.category = value;}}; },
        statusLabel() { return this.busy ? 'Loading…' : this.total + ' articles'; },
        empty() { return !this.busy && !this.message && this.total === 0; },
        expandedLabel() { return this.expanded === this.post.id ? 'true' : 'false'; },
        favoriteLabel() { return this.favorites.includes(this.post.id) ? 'Unfavorite' : 'Favorite'; },
        postExpanded() { return this.expanded === this.post.id; },
        multiplePages() { return this.pages > 1; },
        previousDisabled() { return this.busy || this.page <= 1; },
        nextDisabled() { return this.busy || this.page >= this.pages; },
        pageLabel() { return 'Page ' + this.page + ' of ' + this.pages; },
        init() {
            postsUrl = postsUrl || this.$el.dataset.postsUrl;
            const params = new URLSearchParams(window.location.search);
            this.query = params.get('q') || '';
            this.category = params.get('category') || '';
            try {
                const saved = JSON.parse(window.localStorage.getItem('application.blog.favorites') || '[]');
                this.favorites = Array.isArray(saved) ? saved.filter(Number.isInteger) : [];
            } catch (error) { this.favorites = []; }
            this.loadPosts();
        },
        search() {
            this.page = 1;
            const params = new URLSearchParams();
            if (this.query) params.set('q', this.query);
            if (this.category) params.set('category', this.category);
            window.history.replaceState(null, '', window.location.pathname + (params.size ? '?' + params : ''));
            return this.loadPosts();
        },
        async loadPosts() {
            this.busy = true;
            this.message = '';
            try {
                const url = new URL(postsUrl, window.location.href);
                for (const name of ['query', 'category', 'page']) url.searchParams.set(name === 'query' ? 'q' : name, this[name]);
                const response = await fetch(url, {headers: {'X-Requested-With': 'XMLHttpRequest'}});
                if (!response.ok) throw new Error('Article request failed');
                const data = await response.json();
                this.posts = data.posts;
                this.page = data.page;
                this.pages = data.pages;
                this.total = data.total;
                this.expanded = null;
            } catch (error) {
                this.posts = [];
                this.total = 0;
                this.message = 'Could not load articles. Please try again.';
            } finally { this.busy = false; }
        },
        next() { if (this.page < this.pages) { this.page++; return this.loadPosts(); } },
        previous() { if (this.page > 1) { this.page--; return this.loadPosts(); } },
        toggleDetails() { const post = this.post; this.expanded = this.expanded === post.id ? null : post.id; },
        toggleFavorite() {
            const post = this.post;
            if (this.favorites.includes(post.id)) {
                this.favorites = this.favorites.filter(id => id !== post.id);
                this.favoriteNotice = '';
            } else {
                this.favorites.push(post.id);
                this.favoriteNotice = post.title + ' is saved locally.';
            }
            try { window.localStorage.setItem('application.blog.favorites', JSON.stringify(this.favorites)); }
            catch (error) { this.message = 'Favorites are available for this visit only. Browser storage is unavailable.'; }
        }
    };
};

document.addEventListener('alpine:init', () => Alpine.data('applicationBlog', () => window.applicationBlog()));
