// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const path = require('node:path');
const {test, expect, fixtures, headers, get, message, login, section, findRecord, save, remove, visitBlog, fillPost, fillComment} = require('./support');

test.describe('Blog Admin and publishing', () => {
    test('creates a category and illustrated article, publishes, moderates comments, and deletes records', async ({page}) => {
        test.setTimeout(180000);
        const f = fixtures(), query = 'Admin-' + f.run;
        const title = query + ' Published in Admin', slug = f.prefix + 'admin-article', category = query + ' Editors';
        const article = '/blog/post/view/slug/' + slug;
        const requestArticle = () => page.request.get(article, {headers: headers()});
        await login(page);
        await section(page, 'categories');
        await get(page, 'admin-new').click();
        await page.locator('#category-name').fill(category);
        await page.locator('#category-slug').fill(f.prefix + 'editors');
        await save(page);
        await section(page, 'posts');
        await get(page, 'admin-new').click();
        await fillPost(page, title, slug, category);
        await page.locator('#blog-meta_title').fill('An editorial journey');
        await page.locator('#blog-meta_description').fill('A complete article from our editorial team.');
        await page.locator('#blog-image').setInputFiles(path.join(__dirname, '../Cypress/featured.png'));
        await expect(get(page, 'editor-preview')).toContainText(title);
        await expect.poll(async () => Number(await get(page, 'word-count').textContent())).toBeGreaterThan(5);
        await expect(get(page, 'draft-notice')).toBeVisible();
        await save(page);
        await expect(get(page, 'existing-image')).toBeVisible();
        expect((await requestArticle()).status()).toBe(404);
        await page.locator('#blog-status').selectOption('published');
        await page.locator('#blog-date').fill('2099-01-01T12:00');
        await save(page);
        expect((await requestArticle()).status()).toBe(404);
        await page.locator('#blog-date').fill('');
        await save(page);
        await visitBlog(page, title);
        await expect(get(page, 'status')).toHaveText('1 articles');
        await expect(get(page, 'post').locator('img')).toBeVisible();
        await get(page, 'read-post').click();
        await expect(get(page, 'article-title')).toHaveText(title);
        await expect(page).toHaveTitle(/An editorial journey/);
        await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'A complete article from our editorial team.');
        await expect(get(page, 'featured-image')).toBeVisible();
        await expect.poll(() => get(page, 'featured-image').evaluate(image => image.naturalWidth)).toBe(32);
        await expect(get(page, 'article-body')).toContainText('<script>');
        await expect(get(page, 'article-body').locator('script')).toHaveCount(0);
        await fillComment(page, query + ' Reader', 'private-reader@example.test', 'Thoughtful article. <img src=x onerror=alert(1)>');
        await get(page, 'comment-submit').click();
        await expect(message(page, 'success')).toContainText('awaiting moderation');
        await expect(get(page, 'approved-comment')).toHaveCount(0);
        await fillComment(page, 'Another reader', 'another@example.test', 'Too soon');
        await get(page, 'comment-submit').click();
        await expect(message(page, 'error')).toContainText('wait a minute');
        await page.goto('/admin/');
        await section(page, 'comments');
        await findRecord(page, query + ' Reader');
        await expect(get(page, 'comment-content')).toContainText('<img');
        await page.locator('#comment-status').selectOption('approved');
        await save(page);
        await page.goto(article);
        await expect(get(page, 'approved-comment')).toHaveCount(1);
        await expect(get(page, 'approved-comment')).toContainText('Thoughtful article. <img');
        await expect(get(page, 'approved-comment').locator('img')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText('private-reader@example.test');
        await page.goto('/admin/');
        await section(page, 'categories');
        await findRecord(page, category);
        await page.locator('#category-active').selectOption('0');
        await save(page);
        expect((await requestArticle()).status()).toBe(404);
        await page.locator('#category-active').selectOption('1');
        await save(page);
        await get(page, 'admin-delete').click();
        await page.locator('.modal-popup._show .action-accept').click();
        await expect(message(page, 'error')).toContainText('Move or delete');
        await section(page, 'comments');
        await findRecord(page, query + ' Reader');
        await page.locator('#comment-status').selectOption('rejected');
        await save(page);
        expect(await (await requestArticle()).text()).not.toContain('Thoughtful article.');
        await remove(page);
        await section(page, 'posts');
        await findRecord(page, title);
        await page.locator('[name="remove_image"]').check();
        await save(page);
        await expect(get(page, 'existing-image')).toHaveCount(0);
        expect(await (await requestArticle()).text()).not.toContain('data-cy="featured-image"');
        await remove(page);
        expect((await requestArticle()).status()).toBe(404);
        await section(page, 'categories');
        await findRecord(page, category);
        await remove(page);
        await get(page, 'admin-search').fill(category);
        await get(page, 'admin-search-submit').click();
        await expect(get(page, 'admin-row')).toHaveCount(0);
    });

    test('validates Admin input, preserves form values, and rejects forged writes', async ({page}) => {
        const f = fixtures();
        await login(page);
        await section(page, 'categories');
        await get(page, 'admin-new').click();
        await page.locator('#category-name').fill(f.query + ' Invalid');
        await page.locator('#category-slug').fill('Invalid Slug');
        await get(page, 'admin-save').click();
        await expect(message(page, 'error')).toContainText('lowercase');
        await expect(page.locator('#category-name')).toHaveValue(f.query + ' Invalid');
        await page.locator('#category-slug').fill(f.prefix + 'engineering');
        await get(page, 'admin-save').click();
        await expect(message(page, 'error')).toContainText('slug already exists');
        await section(page, 'posts');
        await get(page, 'admin-new').click();
        await fillPost(page, f.query + ' Invalid post', f.prefix + 'article-1', f.query + ' Engineering');
        await get(page, 'admin-save').click();
        await expect(message(page, 'error')).toContainText('slug already exists');
        await page.locator('#blog-slug').fill(f.prefix + 'invalid-post');
        await page.locator('#blog-image').setInputFiles({buffer: Buffer.from('not an image'), name: 'fake.png', mimeType: 'image/png'});
        await get(page, 'admin-save').click();
        await expect(message(page, 'error')).toContainText('image');
        await expect(page.locator('#blog-title')).toHaveValue(f.query + ' Invalid post');
        const form = await get(page, 'admin-form').evaluate(form => ({url: form.action,
            values: Object.fromEntries([...new FormData(form)].filter(([, value]) => typeof value === 'string'))}));
        const response = await page.request.post(form.url, {form: {...form.values, form_key: 'invalid'}, headers: headers(), maxRedirects: 0});
        expect([302, 303]).toContain(response.status());
        await section(page, 'posts');
        await get(page, 'admin-search').fill(f.query + ' Invalid post');
        await get(page, 'admin-search-submit').click();
        await expect(get(page, 'admin-row')).toHaveCount(0);
    });

    test('requires Admin authentication and the Blog ACL permission', async ({page}) => {
        const f = fixtures();
        await page.goto('/admin/application_blog/manage/index/section/posts');
        await expect(page.locator('#username')).toBeVisible();
        await login(page, f.readerUser, f.readerPassword);
        await expect(page.locator('#menu-application-blog-manage')).toHaveCount(0);
        const formKey = await page.evaluate(() => window.FORM_KEY);
        expect(typeof formKey).toBe('string');
        const response = await page.request.post('/admin/application_blog/manage/save/section/categories', {
            headers: headers(), form: {form_key: formKey, name: 'Forbidden', slug: f.prefix + 'forbidden', is_active: '1'}
        });
        expect(response.status()).toBe(403);
    });
});
