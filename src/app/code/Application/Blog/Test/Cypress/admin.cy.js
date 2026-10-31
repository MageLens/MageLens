// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

import {fixtures, headers, get, login, section, findRecord, save, remove, visitBlog} from './support';

function fillPost(title, slug, category) {
    cy.get('#blog-title').clear().type(title);
    cy.get('#blog-slug').clear().type(slug);
    cy.get('#blog-author').clear().type('Editorial team');
    cy.get('#blog-excerpt').clear().type('An article written and published from Magento Admin.');
    cy.get('#blog-body').clear().type('A complete publishing workflow.\nReader input stays plain text: <script>alert(1)</script>.');
    cy.get('#blog-category').select(category);
}

describe('Blog Admin and publishing', () => {
    it('creates a category and illustrated article, publishes, moderates comments, and deletes records', () => {
        // Keep records created here out of the storefront scenario's search,
        // even if this scenario stops before reaching its deletion checks.
        const f = fixtures(), query = 'Admin-' + f.run;
        const title = query + ' Published in Admin', slug = f.prefix + 'admin-article', category = query + ' Editors';
        login();
        section('categories');
        get('admin-new').click();
        cy.get('#category-name').type(category);
        cy.get('#category-slug').type(f.prefix + 'editors');
        save();
        section('posts');
        get('admin-new').click();
        fillPost(title, slug, category);
        cy.get('#blog-meta_title').type('An editorial journey');
        cy.get('#blog-meta_description').type('A complete article from our editorial team.');
        cy.get('#blog-image').selectFile(Cypress.spec.relative.replace(/[^/]+$/, 'featured.png'));
        get('editor-preview').should('contain', title);
        get('word-count').invoke('text').then(count => expect(Number(count)).to.be.greaterThan(5));
        get('draft-notice').should('be.visible');
        cy.screenshot('blog-admin-editor', {capture: 'viewport'});
        save();
        get('existing-image').should('be.visible');
        cy.request({url: '/blog/post/view/slug/' + slug, headers: headers(), failOnStatusCode: false}).its('status').should('equal', 404);
        cy.get('#blog-status').select('published');
        cy.get('#blog-date').type('2099-01-01T12:00');
        save();
        cy.request({url: '/blog/post/view/slug/' + slug, headers: headers(), failOnStatusCode: false}).its('status').should('equal', 404);
        cy.get('#blog-date').clear();
        save();
        visitBlog(title);
        get('status').should('have.text', '1 articles');
        get('post').find('img').should('be.visible');
        get('read-post').click();
        get('article-title').should('have.text', title);
        cy.title().should('contain', 'An editorial journey');
        cy.get('meta[name="description"]').should('have.attr', 'content', 'A complete article from our editorial team.');
        get('featured-image').should('be.visible').and(image => expect(image[0].naturalWidth).to.equal(32));
        get('article-body').should('contain', '<script>').find('script').should('not.exist');
        cy.screenshot('blog-storefront-article', {capture: 'viewport'});
        get('comment-form').within(() => {
            cy.get('[name="name"]').type(query + ' Reader');
            cy.get('[name="email"]').type('private-reader@example.test');
            cy.get('[name="body"]').type('Thoughtful article. <img src=x onerror=alert(1)>');
        });
        get('comment-submit').click();
        cy.get('.message-success, .message.success').should('contain', 'awaiting moderation');
        get('approved-comment').should('not.exist');
        get('comment-form').within(() => {
            cy.get('[name="name"]').type('Another reader');
            cy.get('[name="email"]').type('another@example.test');
            cy.get('[name="body"]').type('Too soon');
        });
        get('comment-submit').click();
        cy.get('.message-error, .message.error').should('contain', 'wait a minute');
        cy.visit('/admin/');
        section('comments');
        findRecord(query + ' Reader');
        get('comment-content').should('contain', '<img');
        cy.get('#comment-status').select('approved');
        save();
        cy.visit('/blog/post/view/slug/' + slug);
        get('approved-comment').should('have.length', 1).and('contain', 'Thoughtful article. <img');
        get('approved-comment').find('img').should('not.exist');
        cy.get('body').should('not.contain', 'private-reader@example.test');
        cy.visit('/admin/');
        section('categories');
        findRecord(category);
        cy.get('#category-active').select('0');
        save();
        cy.request({url: '/blog/post/view/slug/' + slug, headers: headers(), failOnStatusCode: false}).its('status').should('equal', 404);
        cy.get('#category-active').select('1');
        save();
        get('admin-delete').click();
        cy.get('.modal-popup._show .action-accept').click();
        cy.get('.message-error, .message.error').should('contain', 'Move or delete');
        section('comments');
        findRecord(query + ' Reader');
        cy.get('#comment-status').select('rejected');
        save();
        cy.request({url: '/blog/post/view/slug/' + slug, headers: headers()}).its('body').should('not.contain', 'Thoughtful article.');
        remove();
        section('posts');
        findRecord(title);
        cy.get('[name="remove_image"]').check();
        save();
        get('existing-image').should('not.exist');
        cy.request({url: '/blog/post/view/slug/' + slug, headers: headers()}).its('body').should('not.contain', 'data-cy="featured-image"');
        remove();
        cy.request({url: '/blog/post/view/slug/' + slug, headers: headers(), failOnStatusCode: false}).its('status').should('equal', 404);
        section('categories');
        findRecord(category);
        remove();
        get('admin-search').type(category);
        get('admin-search-submit').click();
        get('admin-row').should('not.exist');
    });

    it('validates Admin input, preserves form values, and rejects forged writes', () => {
        const f = fixtures();
        login();
        section('categories');
        get('admin-new').click();
        cy.get('#category-name').type(f.query + ' Invalid');
        cy.get('#category-slug').type('Invalid Slug');
        get('admin-save').click();
        cy.get('.message-error, .message.error').should('contain', 'lowercase');
        cy.get('#category-name').should('have.value', f.query + ' Invalid');
        cy.get('#category-slug').clear().type(f.prefix + 'engineering');
        get('admin-save').click();
        cy.get('.message-error, .message.error').should('contain', 'slug already exists');
        section('posts');
        get('admin-new').click();
        fillPost(f.query + ' Invalid post', f.prefix + 'article-1', f.query + ' Engineering');
        get('admin-save').click();
        cy.get('.message-error, .message.error').should('contain', 'slug already exists');
        cy.get('#blog-slug').clear().type(f.prefix + 'invalid-post');
        cy.get('#blog-image').selectFile({contents: Cypress.Buffer.from('not an image'), fileName: 'fake.png', mimeType: 'image/png'});
        get('admin-save').click();
        cy.get('.message-error, .message.error').should('contain', 'image');
        cy.get('#blog-title').should('have.value', f.query + ' Invalid post');
        get('admin-form').then($form => {
            const body = Object.fromEntries($form.serializeArray().map(field => [field.name, field.value]));
            body.form_key = 'invalid';
            cy.request({url: $form.attr('action'), method: 'POST', form: true, headers: headers(), body, followRedirect: false})
                .its('status').should('be.oneOf', [302, 303]);
        });
        section('posts');
        get('admin-search').type(f.query + ' Invalid post');
        get('admin-search-submit').click();
        get('admin-row').should('not.exist');
    });

    it('requires Admin authentication and the Blog ACL permission', () => {
        const f = fixtures();
        cy.visit('/admin/application_blog/manage/index/section/posts');
        cy.get('#username').should('be.visible');
        login(f.readerUser, f.readerPassword);
        cy.get('#menu-application-blog-manage').should('not.exist');
        cy.window().then(win => {
            expect(win.FORM_KEY).to.be.a('string');
            cy.request({url: '/admin/application_blog/manage/save/section/categories', method: 'POST', form: true,
                headers: headers(), failOnStatusCode: false, body: {form_key: win.FORM_KEY, name: 'Forbidden', slug: f.prefix + 'forbidden', is_active: '1'}})
                .its('status').should('equal', 403);
        });
    });
});
