// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test, expect, fixtures, headers, get, message, login, section, fillPost} = require('./support');

test.describe('Blog Admin input validation', () => {
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
});
