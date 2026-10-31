// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {fixtures, headers, get, search, visitBlog, waitForBlog} from './support';

describe('Blog storefront', () => {
    it('searches, filters, paginates, reads articles, and retains favorites', () => {
        const f = fixtures();
        cy.intercept('GET', '**/Application_Blog/template/theme-note.html*').as('themeNote');
        visitBlog(f.query);
        if (f.themePaths[0] === 'Application/coverage') {
            cy.get('[data-cy="theme-note"]', {timeout: Cypress.config('pageLoadTimeout')})
                .should('contain', 'Ideas, engineering');
            cy.wait('@themeNote').its('request.url').should('include', `/frontend/${f.themePaths[0]}/`);
        }
        get('status').should('have.text', '8 articles');
        get('post').should('have.length', 6);
        get('post').first().within(() => {
            get('details').click().should('have.attr', 'aria-expanded', 'true');
            get('post-body').should('contain', '<script>');
            cy.get('script').should('not.exist');
            get('details').click().should('have.attr', 'aria-expanded', 'false');
            get('post-body').should('not.exist');
            get('favorite').click().should('have.text', 'Unfavorite');
        });
        get('favorite-notice').should('contain', 'is saved locally.');
        cy.reload();
        waitForBlog();
        get('status').should('have.text', '8 articles');
        get('post').first().find('[data-cy="favorite"]').should('have.text', 'Unfavorite').click().should('have.text', 'Favorite');
        get('next').click();
        get('page-number').should('have.text', 'Page 2 of 2');
        get('post').should('have.length', 2);
        get('next').should('be.disabled');
        get('previous').click();
        get('post').should('have.length', 6);
        search(f.query, f.prefix + 'people');
        get('status').should('have.text', '2 articles');
        get('post').should('have.length', 2);
        get('post').first().find('[data-cy="read-post"]').click();
        get('article-title').should('contain', f.query);
        get('article-body').should('contain', '<script>');
        get('article-body').find('script').should('not.exist');
        cy.get('link[rel="canonical"]').should('have.attr', 'href').and('include', f.prefix);
        get('no-comments').should('be.visible');
        cy.contains('a', 'All articles').click();
        waitForBlog();
        search(f.query, f.prefix + 'engineering');
        get('status').should('have.text', '6 articles');
        search(f.query + '-missing');
        get('empty').should('be.visible');
        get('post').should('not.exist');
        get('editorial-preview').should('not.exist');
        get('unpublished-post').should('not.exist');
        for (let repeat = 0; repeat < 3; repeat++) {
            cy.request({url: `/blog/index/posts?q=${f.query}&category=${f.prefix}people&page=1`, headers: headers()}).then(response => {
                expect(response.status).to.equal(200);
                expect(response.body.total).to.equal(2);
                expect(response.body.posts.map(post => post.slug)).to.deep.equal([f.prefix + 'article-8', f.prefix + 'article-7']);
            });
        }
    });

    it('rejects invalid filters and keeps draft, scheduled, and inactive-category posts private', () => {
        const f = fixtures();
        for (const query of ['page=0', 'page[]=1', 'q[]=invalid', 'category=Invalid', 'q=' + 'x'.repeat(201)]) {
            cy.request({url: '/blog/index/posts?' + query, headers: headers(), failOnStatusCode: false})
                .its('status').should('equal', 400);
        }
        for (const slug of ['article-9', 'article-10', 'article-11', 'missing']) {
            cy.request({url: '/blog/post/view/slug/' + f.prefix + slug, headers: headers(), failOnStatusCode: false})
                .its('status').should('equal', 404);
        }
        cy.visit('/blog/post/view/slug/' + f.prefix + 'article-1');
        get('comment-form').invoke('attr', 'action').then(url => {
            // Keep the rejection message for the browser instead of consuming it on a followed redirect.
            cy.request({url, method: 'POST', form: true, followRedirect: false, headers: headers(), body: {form_key: 'invalid', name: 'Rejected reader', email: 'reader@example.test', body: 'Must not appear'}})
                .its('status').should('equal', 302);
        });
        cy.reload();
        cy.get('.message-error, .message.error').should('contain', 'Invalid Form Key');
        get('no-comments').should('be.visible');
        get('comment-form').within(() => {
            cy.get('[name="name"]').type('Reader');
            cy.get('[name="email"]').type('reader@example.test');
            cy.get('[name="body"]').type('A comment with an invalid email');
            cy.get('[name="email"]').invoke('val', 'invalid');
        }).invoke('attr', 'novalidate', 'novalidate');
        get('comment-submit').click();
        cy.get('.message-error, .message.error').should('contain', 'valid email');
        get('approved-comment').should('not.exist');
        visitBlog();
        cy.intercept('GET', /\/blog\/index\/posts[/?]/, {statusCode: 503, body: {error: 'Unavailable'}}).as('unavailable');
        search('unavailable');
        cy.wait('@unavailable');
        get('load-error').should('be.visible').and('contain', 'Could not load articles');
    });
});
