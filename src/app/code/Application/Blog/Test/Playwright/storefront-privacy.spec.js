// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

const {test, expect, fixtures, headers, get, visitBlog, waitForStorefront, search, fillComment, storefrontMessage} = require('./support');

test.describe('Blog storefront privacy and filters', () => {
    test('rejects invalid filters and keeps draft, scheduled, and inactive-category posts private', async ({page}) => {
        const f = fixtures();
        for (const query of ['page=0', 'page[]=1', 'q[]=invalid', 'category=Invalid', 'q=' + 'x'.repeat(201)]) {
            expect((await page.request.get('/blog/index/posts?' + query, {headers: headers()})).status()).toBe(400);
        }
        for (const slug of ['article-9', 'article-10', 'article-11', 'missing']) {
            expect((await page.request.get('/blog/post/view/slug/' + f.prefix + slug, {headers: headers()})).status()).toBe(404);
        }
        await page.goto('/blog/post/view/slug/' + f.prefix + 'article-1');
        await waitForStorefront(page);
        const action = await get(page, 'comment-form').getAttribute('action');
        // Keep the forged POST, redirect and rejection cookie in one browser navigation.
        const response = page.waitForResponse(response => response.url() === action && response.request().method() === 'POST');
        await get(page, 'comment-form').evaluate(form => {
            for (const [name, value] of Object.entries({form_key: 'invalid', name: 'Rejected reader', email: 'reader@example.test', body: 'Must not appear'})) {
                form.elements.namedItem(name).value = value;
            }
            form.submit();
        });
        expect((await response).status()).toBe(302);
        await storefrontMessage(page, 'error', 'Invalid Form Key');
        await expect(get(page, 'no-comments')).toBeVisible();
        await fillComment(page, 'Reader', 'invalid', 'A comment with an invalid email');
        await get(page, 'comment-form').evaluate(form => form.noValidate = true);
        await get(page, 'comment-submit').click();
        await storefrontMessage(page, 'error', 'valid email');
        await expect(get(page, 'approved-comment')).toHaveCount(0);
        await visitBlog(page);
        await page.route(/\/blog\/index\/posts[/?]/, route => route.fulfill({status: 503, json: {error: 'Unavailable'}}));
        await search(page, 'unavailable');
        await expect(get(page, 'load-error')).toBeVisible();
        await expect(get(page, 'load-error')).toContainText('Could not load articles');
    });
});
