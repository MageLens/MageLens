// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test, expect, fixtures, headers, login} = require('./support');

test.describe('Blog Admin permissions', () => {
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
